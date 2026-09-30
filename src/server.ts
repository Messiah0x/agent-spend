import { Hono, type Context } from "hono";
import { basicAuth } from "hono/basic-auth";
import { isAddress, type Address } from "viem";
import type { Config } from "./config.js";
import type { Db, PaymentRow, KeyEventRow } from "./db.js";
import { keyStatus } from "./keys.js";
import type { Indexer } from "./indexer.js";
import type { Reader } from "./reads.js";
import {
  formatAmount,
  formatSmallAmount,
  formatTime,
  relativeTime,
  shortAddress,
  shortHash,
  shortMemo,
} from "./format.js";
import { createApi, enrichPayments, type EnrichedPayment } from "./api.js";
import { canonicalJson, recoverSigner } from "./reasons.js";
import { csrfProtection, limitBody, rateLimit, securityHeaders } from "./security.js";
import { layout, statusBadge, emptyState, escapeHtml, dataTable, type NavContext } from "./ui.js";


function txCell(txHash: string, explorerUrl?: string): string {
  const label = `<span class="mono">${escapeHtml(shortHash(txHash))}</span>`;
  if (!explorerUrl) return label;
  const href = `${explorerUrl.replace(/\/$/, "")}/tx/${txHash}`;
  return `<a class="txlink" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

/**
 * Agent identity cell: the human-readable name if one has been set (address
 * demoted to a secondary line), otherwise the address alone — unchanged from
 * before this feature existed.
 */
function agentCell(labels: Map<string, string>, account: string, keyId: string): string {
  const name = labels.get(`${account}|${keyId}`);
  const addr = `<span class="mono">${escapeHtml(shortAddress(keyId))}</span>`;
  return name ? `<div><span class="agent-name">${escapeHtml(name)}</span><div class="sub">${addr}</div></div>` : addr;
}

/** Inline name/rename form shown only on the Overview page. */
function agentLabelForm(account: string, keyId: string, current: string | undefined): string {
  return `<form method="post" action="/agents/${escapeHtml(account)}/${escapeHtml(keyId)}/label" class="label-form">
    <input type="text" name="label" value="${escapeHtml(current ?? "")}" placeholder="Name this agent" maxlength="64" aria-label="Agent name">
    <button type="submit">${current ? "Rename" : "Save"}</button>
  </form>`;
}

function verdictBadge(verdict: EnrichedPayment["verdict"]): string {
  if (verdict === "verified") {
    return `<span class="badge badge-active" title="The on-chain payment matches the signed reason record exactly"><span class="dot"></span>Verified</span>`;
  }
  if (verdict === "mismatch") {
    return `<span class="badge badge-revoked" title="The on-chain payment differs from what the agent's signed reason describes"><span class="dot"></span>Mismatch</span>`;
  }
  return "";
}

function recipientCell(p: EnrichedPayment): string {
  if (p.kind === "payment" && p.to_addr) return `<span class="mono">${escapeHtml(shortAddress(p.to_addr))}</span>`;
  if (p.kind === "fee") {
    return `<span class="chip chip-fee" title="Per-transaction fee debited from this key's spending limit">network fee</span>`;
  }
  return `<span class="chip chip-fee" title="Budget debit with no matching token transfer">other debit</span>`;
}

/** Reason text (linked to the payment's proof page) or the raw memo chip when none is on file. */
function reasonCell(p: EnrichedPayment): string {
  if (p.kind !== "payment") return `<span class="muted">—</span>`;
  const href = `/payments/${escapeHtml(p.tx_hash)}`;
  if (p.reason) {
    const text = p.reason.record.reason;
    const short = text.length > 90 ? `${text.slice(0, 87)}…` : text;
    return `<div class="reason-cell"><a class="reason-link" href="${href}" title="${escapeHtml(text)}">${escapeHtml(short)}</a> ${verdictBadge(p.verdict)}</div>`;
  }
  const memo = shortMemo(p.memo);
  return memo
    ? `<a href="${href}" class="chip" title="${escapeHtml(p.memo!)} — no reason on file">${escapeHtml(memo)}</a>`
    : `<a href="${href}" class="muted">no memo</a>`;
}

/** Route params that name an account/key must be addresses — reject anything else early. */
function addressParams(c: Context): { account: string; keyId: string } | null {
  const { account, keyId } = c.req.param() as { account?: string; keyId?: string };
  if (!account || !keyId || !isAddress(account, { strict: false }) || !isAddress(keyId, { strict: false })) {
    return null;
  }
  return { account: account.toLowerCase(), keyId: keyId.toLowerCase() };
}

export function createServer(config: Config, db: Db, reader: Reader, indexer?: Indexer) {
  const app = new Hono();
  const network =
    config.chainId === 42431 ? "Tempo Moderato" : config.chainId === 4217 ? "Tempo" : `Chain ${config.chainId}`;
  const symbolFor = (token: string) =>
    config.tokens.find((t) => t.address.toLowerCase() === token.toLowerCase())?.symbol ??
    shortAddress(token);
  const nav = (active: NavContext["active"]): NavContext => ({ active, network });
  const page = (c: Context, title: string, active: NavContext["active"], body: string, status: 200 | 404 = 200) =>
    c.html(layout(title, nav(active), body, c.get("nonce")), status);

  const amountHtml = (baseUnits: string | bigint, token: string, sign = "") =>
    `<span class="amount">${sign}${formatAmount(baseUnits)}<span class="sym">${escapeHtml(symbolFor(token))}</span></span>`;
  const feeHtml = (baseUnits: string | bigint, token: string) =>
    `<span class="amount">${formatSmallAmount(baseUnits)}<span class="sym">${escapeHtml(symbolFor(token))}</span></span>`;

  // ── Hardening (applies to every route) ────────────────────────────────────
  app.use("*", securityHeaders());
  app.use("*", limitBody());
  app.use("*", csrfProtection(config.publicUrl));
  // Write routes: bounds Basic Auth brute force and API spam per client IP.
  app.use(
    "*",
    rateLimit({
      windowMs: 60_000,
      max: 60,
      trustProxy: config.trustProxy,
      when: (c) => c.req.method !== "GET" && c.req.method !== "HEAD",
    }),
  );
  app.onError((err, c) => {
    if ("getResponse" in err && typeof err.getResponse === "function") return err.getResponse();
    console.error("[server] unhandled error:", err);
    return c.text("Internal Server Error", 500);
  });
  app.notFound((c) =>
    page(c, "Not found", "overview", emptyState("Page not found", "That page doesn't exist."), 404),
  );

  // ── Overview ──────────────────────────────────────────────────────────────
  app.get("/", async (c) => {
    const keys = db.listKeys();
    const totals = db.spendTotals();
    const lastSpends = db.lastSpendTimes();
    const labels = db.listLabels();

    const budgets = await Promise.all(
      keys.map((k) =>
        keyStatus(k) === "active"
          ? reader.remainingBudgets(k.account as Address, k.key_id as Address)
          : Promise.resolve({ budgets: [], unavailable: false }),
      ),
    );

    const activeCount = keys.filter((k) => keyStatus(k) === "active").length;
    let totalSpent = 0n;
    for (const v of totals.values()) totalSpent += v;
    const primarySymbol = config.tokens[0]?.symbol ?? "";

    const rows = keys.map((k, i) => {
      const status = keyStatus(k);
      const spentByToken = config.tokens
        .map((t) => ({
          t,
          v: totals.get(`${k.account}|${k.key_id}|${t.address.toLowerCase()}`) ?? 0n,
        }))
        .filter((x) => x.v > 0n);
      const spentHtml = spentByToken.length
        ? spentByToken.map((x) => amountHtml(x.v, x.t.address)).join("<br>")
        : `<span class="muted">—</span>`;

      const budgetHtml =
        status !== "active"
          ? `<span class="muted">—</span>`
          : budgets[i]!.unavailable
            ? `<span class="budget-error" title="Could not read remaining budget from the chain. Check the RPC connection.">unavailable</span>`
            : budgets[i]!.budgets.length
              ? budgets[i]!.budgets
                  .map((b) => {
                    const resets =
                      b.periodEnd > 0
                        ? `<div class="sub">resets ${escapeHtml(formatTime(b.periodEnd))}</div>`
                        : "";
                    return `<div>${amountHtml(b.remaining, b.token)}${resets}</div>`;
                  })
                  .join("")
              : `<span class="muted">no limit set</span>`;

      const last = lastSpends.get(`${k.account}|${k.key_id}`);
      return [
        `<div>${agentCell(labels, k.account, k.key_id)}
          <div class="sub">account ${escapeHtml(shortAddress(k.account))}</div>
          ${agentLabelForm(k.account, k.key_id, labels.get(`${k.account}|${k.key_id}`))}</div>`,
        statusBadge(status),
        budgetHtml,
        spentHtml,
        last ? escapeHtml(relativeTime(last)) : `<span class="muted">never</span>`,
      ];
    });

    const table = keys.length
      ? dataTable(
          [
            { label: "Agent" },
            { label: "Status" },
            { label: "Remaining budget", num: true },
            { label: "Total spent", num: true },
            { label: "Last active" },
          ],
          rows,
        )
      : emptyState(
          "No agent keys yet",
          "Access keys authorized by the watched accounts will appear here automatically.",
        );

    const body = `
      <h1 class="page-title">Overview</h1>
      <p class="page-sub">Agent spending on ${escapeHtml(network)}, enforced on-chain by access keys.</p>
      <div class="stats">
        <div class="stat"><div class="stat-label">Active agents</div><div class="stat-value">${activeCount}</div></div>
        <div class="stat"><div class="stat-label">Total spent</div><div class="stat-value">${formatAmount(totalSpent)}<span class="unit">${escapeHtml(primarySymbol)}</span></div></div>
        <div class="stat"><div class="stat-label">Payments</div><div class="stat-value">${db.paymentCount()}</div></div>
      </div>
      <div class="card">
        <div class="card-head"><span class="card-title">Agents</span><span class="card-note">budgets read live from AccountKeychain</span></div>
        ${table}
      </div>`;
    return page(c, "Overview", "overview", body);
  });

  // ── Activity ──────────────────────────────────────────────────────────────
  app.get("/activity", (c) => {
    const all = enrichPayments(db, db.listPayments({ limit: 300 }));
    // Fold each per-tx fee debit into its payment's row (shown as a sub-line),
    // so the feed reads as one row per payment.
    const feesByTx = new Map<string, bigint>();
    for (const p of all) {
      if (p.kind === "fee") feesByTx.set(p.tx_hash, (feesByTx.get(p.tx_hash) ?? 0n) + BigInt(p.amount));
    }
    const payments = all.filter((p) => p.kind !== "fee").slice(0, 200);
    const labels = db.listLabels();
    const rows = payments.map((p) => [
      `<span class="secondary">${escapeHtml(formatTime(p.block_time))}</span>`,
      agentCell(labels, p.account, p.key_id),
      `<div>${amountHtml(p.amount, p.token, "−")}${
        feesByTx.has(p.tx_hash)
          ? `<div class="sub" title="Per-transaction fee, also debited from this key's spending limit">+ ${escapeHtml(formatSmallAmount(feesByTx.get(p.tx_hash)!))} fee</div>`
          : ""
      }</div>`,
      recipientCell(p),
      reasonCell(p),
      amountHtml(p.remaining, p.token),
      txCell(p.tx_hash, config.explorerUrl),
    ]);

    const table = payments.length
      ? dataTable(
          [
            { label: "Time" },
            { label: "Agent" },
            { label: "Amount", num: true },
            { label: "Recipient" },
            { label: "Reason" },
            { label: "Remaining after", num: true },
            { label: "Transaction" },
          ],
          rows,
          (i) => (payments[i]!.kind === "payment" ? undefined : "fee-row"),
        )
      : emptyState("No payments yet", "Agent payments appear here as soon as they settle on-chain.");

    const body = `
      <h1 class="page-title">Activity</h1>
      <p class="page-sub">Every access-key budget debit, joined with its on-chain transfer and the agent's stated reason.</p>
      <div class="card">
        <div class="card-head"><span class="card-title">Payments</span><span class="card-note">most recent first</span></div>
        ${table}
      </div>`;
    return page(c, "Activity", "activity", body);
  });

  // ── Payment detail: the full reason record and its proof ──────────────────
  app.get("/payments/:txHash", async (c) => {
    const txHash = c.req.param("txHash");
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return c.text("Invalid transaction hash", 400);
    const debits = enrichPayments(db, db.listPayments({ txHash, limit: 20 }));
    if (!debits.length) {
      return page(c, "Payment", "activity", emptyState("Payment not found", "No indexed agent debit in that transaction."), 404);
    }
    const labels = db.listLabels();
    const p = debits.find((d) => d.kind === "payment") ?? debits[0]!;
    const fee = debits.filter((d) => d.kind === "fee").reduce((sum, d) => sum + BigInt(d.amount), 0n);
    const signer = p.reason ? await recoverSigner(p.reason.memo as `0x${string}`, p.reason.signature) : null;

    const facts: [string, string][] = [
      ["Agent", agentCell(labels, p.account, p.key_id)],
      ["Account", `<span class="mono wrap">${escapeHtml(p.account)}</span>`],
      ["Amount", amountHtml(p.amount, p.token)],
      ...(fee > 0n ? ([["Network fee (from budget)", feeHtml(fee, p.token)]] as [string, string][]) : []),
      ["Recipient", p.to_addr ? `<span class="mono wrap">${escapeHtml(p.to_addr)}</span>` : `<span class="muted">—</span>`],
      ["Remaining after", amountHtml(p.remaining, p.token)],
      ["Time", escapeHtml(formatTime(p.block_time))],
      ["Block", String(p.block_number)],
      ["Transaction", `${txCell(p.tx_hash, config.explorerUrl)}<div class="sub mono wrap">${escapeHtml(p.tx_hash)}</div>`],
      ["Memo", p.memo ? `<span class="mono wrap">${escapeHtml(p.memo)}</span>` : `<span class="muted">none</span>`],
    ];

    let reasonHtml: string;
    if (p.reason) {
      const r = p.reason.record;
      const ctx = r.context
        ? Object.entries(r.context)
            .map(([k, v]) => `<div class="sub">${escapeHtml(k)}: ${escapeHtml(String(v))}</div>`)
            .join("")
        : "";
      reasonHtml = `
        <div class="reason-quote">${escapeHtml(r.reason)}</div>${ctx}
        <div class="proof">
          ${verdictBadge(p.verdict)}
          ${p.problems.length ? `<ul class="problems">${p.problems.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
          <dl class="facts">
            <dt>Record hash (= on-chain memo)</dt><dd class="mono wrap">${escapeHtml(p.reason.memo)}</dd>
            <dt>Signed by</dt><dd class="mono wrap">${signer ? escapeHtml(signer) : "unrecoverable"}${signer && signer.toLowerCase() === p.key_id ? ` <span class="muted">(this agent's access key)</span>` : ""}</dd>
            <dt>Recorded</dt><dd>${escapeHtml(formatTime(p.reason.created_time))}</dd>
          </dl>
          <details><summary>Canonical record (keccak256 of this = memo)</summary><pre class="mono wrap">${escapeHtml(canonicalJson(r))}</pre></details>
        </div>`;
    } else if (p.memo && shortMemo(p.memo)) {
      reasonHtml = emptyState("No reason on file", "This payment carries a memo, but no matching reason record was submitted to Agent Spend.");
    } else {
      reasonHtml = emptyState("No memo", "This payment was made without a memo, so it can't be linked to a reason.");
    }

    const body = `
      <p class="crumb"><a href="/activity">← Activity</a></p>
      <h1 class="page-title">Payment</h1>
      <p class="page-sub">${escapeHtml(formatAmount(p.amount))} ${escapeHtml(symbolFor(p.token))} to ${escapeHtml(p.to_addr ? shortAddress(p.to_addr) : "—")}</p>
      <div class="grid-2">
        <div class="card"><div class="card-head"><span class="card-title">On-chain</span><span class="card-note">from indexed Tempo events</span></div>
          <dl class="facts pad">${facts.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${v}</dd>`).join("")}</dl>
        </div>
        <div class="card"><div class="card-head"><span class="card-title">Reason</span><span class="card-note">signed by the agent, linked by memo</span></div>
          <div class="pad">${reasonHtml}</div>
        </div>
      </div>`;
    return page(c, "Payment", "activity", body);
  });

  // ── Keys ──────────────────────────────────────────────────────────────────
  app.get("/keys", (c) => {
    const events: KeyEventRow[] = db.keyEvents(200);
    const labels = db.listLabels();
    const describe = (e: KeyEventRow) => {
      switch (e.kind) {
        case "authorized":
          return "Key authorized";
        case "revoked":
          return "Key revoked";
        case "limit_updated":
          return `Spending limit set to ${formatAmount(e.new_limit!)} ${symbolFor(e.token!)}`;
      }
    };
    const rows = events.map((e) => [
      `<span class="secondary">${escapeHtml(formatTime(e.block_time))}</span>`,
      escapeHtml(describe(e)),
      agentCell(labels, e.account, e.key_id),
      `<span class="mono muted">${escapeHtml(shortAddress(e.account))}</span>`,
      e.tx_hash ? txCell(e.tx_hash, config.explorerUrl) : "",
    ]);

    const table = events.length
      ? dataTable(
          [{ label: "Time" }, { label: "Event" }, { label: "Agent" }, { label: "Account" }, { label: "Transaction" }],
          rows,
        )
      : emptyState("No key events yet", "Key authorizations, revocations, and limit changes appear here.");

    const body = `
      <h1 class="page-title">Keys</h1>
      <p class="page-sub">Audit trail of every access-key policy change on watched accounts.</p>
      <div class="card">
        <div class="card-head"><span class="card-title">Key history</span></div>
        ${table}
      </div>`;
    return page(c, "Keys", "keys", body);
  });

  // ── Agent API (JSON) ──────────────────────────────────────────────────────
  app.route("/api/v1", createApi(config, db, reader));

  // ── Agent identity ───────────────────────────────────────────────────────
  // Local to Agent Spend only: never touches Tempo or on-chain enforcement.
  // Fails closed: until ADMIN_USER/ADMIN_PASSWORD are both set, every write
  // under /agents/* is rejected rather than left open on a public deployment.
  app.use("/agents/*", async (c, next) => {
    const { adminUser, adminPassword } = config;
    if (!adminUser || !adminPassword) {
      return c.text("Agent naming is disabled: ADMIN_USER/ADMIN_PASSWORD are not configured.", 503);
    }
    return basicAuth({ username: adminUser, password: adminPassword, realm: "Agent Spend admin" })(c, next);
  });

  app.post("/agents/:account/:keyId/label", async (c) => {
    const params = addressParams(c);
    if (!params) return c.text("Invalid account or key address", 400);
    const body = await c.req.parseBody();
    const label = typeof body.label === "string" ? body.label : "";
    db.setLabel(params.account, params.keyId, label);
    return c.redirect("/");
  });

  app.get("/healthz", (c) => {
    const cursor = db.getCursor();
    const status = indexer?.status();
    // Always 200 (liveness): an unreachable RPC is reported, not "fixed" by a
    // restart loop. Error text is deliberately not exposed — viem errors
    // include the RPC URL, which can carry a provider API key.
    return c.json({
      ok: true,
      indexerHealthy: !status?.lastError,
      lastIndexedBlock: cursor === null ? null : Number(cursor),
      lastPollAt: status?.lastSuccess ? new Date(status.lastSuccess).toISOString() : null,
    });
  });

  return app;
}
