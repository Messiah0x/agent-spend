import { Hono, type Context } from "hono";
import { basicAuth } from "hono/basic-auth";
import { formatUnits, isAddress, parseUnits, type Address, type Hex } from "viem";
import { assessBudgets, type BudgetHealth } from "./alerts.js";
import { approvalJson, createApi, enrichPayments } from "./api.js";
import { isExpired } from "./approvals.js";
import type { Config } from "./config.js";
import type { ApprovalRow, AuditRow, Db, KeyEventRow, KeyRow } from "./db.js";
import {
  formatAmount,
  formatSmallAmount,
  formatTime,
  relativeTime,
  shortAddress,
  shortMemo,
} from "./format.js";
import type { Indexer } from "./indexer.js";
import { keyStatus } from "./keys.js";
import type { Notifier } from "./notify.js";
import type { BudgetsResult, Reader } from "./reads.js";
import { canonicalJson, recoverSigner } from "./reasons.js";
import { csrfProtection, limitBody, rateLimit, securityHeaders } from "./security.js";
import { dataTable, emptyState, escapeHtml, layout, statusBadge, type NavContext } from "./ui.js";
import {
  agentCell,
  agentHref,
  agentLabelForm,
  budgetBar,
  flashBanner,
  reasonCell,
  recipientCell,
  spendChart,
  txCell,
  verdictBadge,
} from "./views.js";
import { describeWriteError, type ChainWriter } from "./writer.js";

export interface ServerDeps {
  indexer?: Indexer;
  /** Operator key executing on-chain controls; absent → controls disabled. */
  writer?: ChainWriter | null;
  notify?: Notifier;
}

const DECIMAL_RE = /^\d{1,15}(\.\d{1,6})?$/;
const PERIODS: { value: number; label: string }[] = [
  { value: 0, label: "One-time (no reset)" },
  { value: 86_400, label: "Per day" },
  { value: 7 * 86_400, label: "Per week" },
  { value: 30 * 86_400, label: "Per 30 days" },
];

/** Route params that name an account/key must be addresses — reject anything else early. */
function addressParams(c: Context): { account: string; keyId: string } | null {
  const { account, keyId } = c.req.param() as { account?: string; keyId?: string };
  if (!account || !keyId || !isAddress(account, { strict: false }) || !isAddress(keyId, { strict: false })) {
    return null;
  }
  return { account: account.toLowerCase(), keyId: keyId.toLowerCase() };
}

/** Parse a user-entered token amount ("12.50") into base units, or null. */
function parseTokenAmount(raw: unknown): bigint | null {
  if (typeof raw !== "string" || !DECIMAL_RE.test(raw.trim())) return null;
  return parseUnits(raw.trim(), 6);
}

/** Only same-site relative paths may be redirect targets (no open redirects). */
function safeRedirect(raw: unknown, fallback = "/"): string {
  if (typeof raw !== "string" || !/^\/(?![/\\])[\w\-/.]*$/.test(raw)) return fallback;
  return raw;
}

function withFlash(path: string, code: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}flash=${encodeURIComponent(code)}`;
}

function healthState(h: BudgetHealth): "ok" | "low" | "exhausted" {
  return h.exhausted ? "exhausted" : h.low ? "low" : "ok";
}

export function createServer(config: Config, db: Db, reader: Reader, deps: ServerDeps | Indexer = {}) {
  // Back-compat: the 4th argument used to be the indexer alone.
  const { indexer, writer, notify } = ("runOnce" in deps ? { indexer: deps } : deps) as ServerDeps;
  const app = new Hono();
  const network =
    config.chainId === 42431 ? "Tempo Moderato" : config.chainId === 4217 ? "Tempo" : `Chain ${config.chainId}`;
  const symbolFor = (token: string) =>
    config.tokens.find((t) => t.address.toLowerCase() === token.toLowerCase())?.symbol ?? shortAddress(token);
  const actor = () => config.adminUser ?? "admin";
  const operatorFor = (account: string) =>
    writer && writer.account.toLowerCase() === account.toLowerCase() ? writer : null;

  const page = (c: Context, title: string, active: NavContext["active"], body: string, status: 200 | 400 | 404 = 200) =>
    c.html(
      layout(
        title,
        { active, network, pendingApprovals: db.pendingApprovalCount() },
        `${flashBanner(c.req.query("flash"))}${body}`,
        c.get("nonce"),
      ),
      status,
    );

  const amountHtml = (baseUnits: string | bigint, token: string, sign = "") =>
    `<span class="amount">${sign}${formatAmount(baseUnits)}<span class="sym">${escapeHtml(symbolFor(token))}</span></span>`;
  const feeHtml = (baseUnits: string | bigint, token: string) =>
    `<span class="amount">${formatSmallAmount(baseUnits)}<span class="sym">${escapeHtml(symbolFor(token))}</span></span>`;
  const tokenOptions = () =>
    config.tokens.map((t) => `<option value="${escapeHtml(t.address)}">${escapeHtml(t.symbol)}</option>`).join("");

  const readBudgets = (k: KeyRow): Promise<BudgetsResult> =>
    keyStatus(k) === "active"
      ? reader.remainingBudgets(k.account as Address, k.key_id as Address)
      : Promise.resolve({ budgets: [], unavailable: false });

  /** Remaining-budget cell: amount, bar, % of limit, reset time. */
  function budgetCell(k: KeyRow, res: BudgetsResult): string {
    if (keyStatus(k) !== "active") return `<span class="muted">—</span>`;
    if (res.unavailable) {
      return `<span class="budget-error" title="Could not read remaining budget from the chain. Check the RPC connection.">unavailable</span>`;
    }
    if (!res.budgets.length) return `<span class="muted">no limit set</span>`;
    return assessBudgets(config, db, k, res.budgets)
      .map((h) => {
        const pct = h.pct !== null ? `<span class="pct pct-${healthState(h)}">${h.pct.toFixed(0)}%</span>` : "";
        const resets = h.periodEnd > 0 ? `<div class="sub">resets ${escapeHtml(formatTime(h.periodEnd))}</div>` : "";
        return `<div class="budget">${amountHtml(h.remaining, h.token)} ${pct}${budgetBar(h.pct, healthState(h))}${resets}</div>`;
      })
      .join("");
  }

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
  app.notFound((c) => page(c, "Not found", "overview", emptyState("Page not found", "That page doesn't exist."), 404));

  // ── Admin guard ───────────────────────────────────────────────────────────
  // Every write that isn't agent-signed (naming, and all on-chain controls)
  // requires the operator's Basic Auth. Fails closed: until ADMIN_USER and
  // ADMIN_PASSWORD are both set, these routes return 503 rather than open.
  const adminGuard = async (c: Context, next: () => Promise<void>) => {
    const { adminUser, adminPassword } = config;
    if (!adminUser || !adminPassword) {
      return c.text("Admin actions are disabled: ADMIN_USER/ADMIN_PASSWORD are not configured.", 503);
    }
    return basicAuth({ username: adminUser, password: adminPassword, realm: "Agent Spend admin" })(c, next);
  };
  app.post("/agents/*", adminGuard);
  app.use("/admin/*", adminGuard);

  // ── Overview ──────────────────────────────────────────────────────────────
  app.get("/", async (c) => {
    const keys = db.listKeys();
    const totals = db.spendTotals();
    const lastSpends = db.lastSpendTimes();
    const labels = db.listLabels();
    const budgets = await Promise.all(keys.map(readBudgets));

    const activeCount = keys.filter((k) => keyStatus(k) === "active").length;
    let totalSpent = 0n;
    for (const v of totals.values()) totalSpent += v;
    const primarySymbol = config.tokens[0]?.symbol ?? "";
    const pending = db.pendingApprovalCount();

    // Needs attention: exhausted/low budgets and pending requests.
    const attention: string[] = [];
    keys.forEach((k, i) => {
      if (keyStatus(k) !== "active" || budgets[i]!.unavailable) return;
      for (const h of assessBudgets(config, db, k, budgets[i]!.budgets)) {
        if (!h.low && !h.exhausted) continue;
        attention.push(
          `<li><span class="dot-${healthState(h)}"></span>${agentCell(labels, k.account, k.key_id)}
           <span>${h.exhausted ? "has exhausted its budget — payments will be rejected on-chain" : `is low: ${escapeHtml(formatAmount(h.remaining))} ${escapeHtml(h.symbol)} left (${h.pct!.toFixed(0)}%)`}</span></li>`,
        );
      }
    });
    if (pending) {
      attention.push(
        `<li><span class="dot-low"></span><a href="/approvals">${pending} budget request${pending === 1 ? "" : "s"} awaiting review</a></li>`,
      );
    }

    const rows = keys.map((k, i) => {
      const spentByToken = config.tokens
        .map((t) => ({ t, v: totals.get(`${k.account}|${k.key_id}|${t.address.toLowerCase()}`) ?? 0n }))
        .filter((x) => x.v > 0n);
      const spentHtml = spentByToken.length
        ? spentByToken.map((x) => amountHtml(x.v, x.t.address)).join("<br>")
        : `<span class="muted">—</span>`;
      const last = lastSpends.get(`${k.account}|${k.key_id}`);
      return [
        `<div>${agentCell(labels, k.account, k.key_id)}
          <div class="sub">account ${escapeHtml(shortAddress(k.account))}</div>
          ${agentLabelForm(k.account, k.key_id, labels.get(`${k.account}|${k.key_id}`))}</div>`,
        statusBadge(keyStatus(k)),
        budgetCell(k, budgets[i]!),
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
      <div class="stats stats-4">
        <div class="stat"><div class="stat-label">Active agents</div><div class="stat-value">${activeCount}</div></div>
        <div class="stat"><div class="stat-label">Total spent</div><div class="stat-value">${formatAmount(totalSpent)}<span class="unit">${escapeHtml(primarySymbol)}</span></div></div>
        <div class="stat"><div class="stat-label">Payments</div><div class="stat-value">${db.paymentCount()}</div></div>
        <div class="stat"><div class="stat-label">Pending requests</div><div class="stat-value">${pending ? `<a href="/approvals">${pending}</a>` : "0"}</div></div>
      </div>
      ${
        attention.length
          ? `<div class="card attention"><div class="card-head"><span class="card-title">Needs attention</span></div><ul class="attention-list">${attention.join("")}</ul></div>`
          : ""
      }
      <div class="card">
        <div class="card-head"><span class="card-title">Agents</span><span class="card-note">budgets read live from AccountKeychain</span></div>
        ${table}
      </div>`;
    return page(c, "Overview", "overview", body);
  });

  // ── Agent detail ──────────────────────────────────────────────────────────
  app.get("/agents/:account/:keyId", async (c) => {
    const params = addressParams(c);
    if (!params) return page(c, "Agent", "overview", emptyState("Invalid agent", "That isn't an account/key address pair."), 400);
    const k = db.getKey(params.account, params.keyId);
    if (!k) return page(c, "Agent", "overview", emptyState("Agent not found", "No indexed access key with that id."), 404);

    const labels = db.listLabels();
    const name = labels.get(`${k.account}|${k.key_id}`);
    const status = keyStatus(k);
    const budgets = await readBudgets(k);
    const health = budgets.unavailable ? [] : assessBudgets(config, db, k, budgets.budgets);
    const now = Math.floor(Date.now() / 1000);
    const primary = config.tokens[0]!;
    const daily = db.dailySpend(k.account, k.key_id, now - 30 * 86_400);
    let spent30 = 0n;
    for (const v of daily.values()) spent30 += v;
    const spent7 = [...daily.entries()]
      .filter(([day]) => day >= new Date((now - 6 * 86_400) * 1000).toISOString().slice(0, 10))
      .reduce((s, [, v]) => s + v, 0n);
    const burnPerDay = spent7 / 7n;
    const primaryHealth = health.find((h) => h.token.toLowerCase() === primary.address.toLowerCase());
    const runway =
      primaryHealth && burnPerDay > 0n ? Number(primaryHealth.remaining / burnPerDay) : null;

    const payments = enrichPayments(db, db.listPayments({ account: k.account, keyId: k.key_id, limit: 300 }));
    const feesByTx = new Map<string, bigint>();
    for (const p of payments) if (p.kind === "fee") feesByTx.set(p.tx_hash, (feesByTx.get(p.tx_hash) ?? 0n) + BigInt(p.amount));
    const shown = payments.filter((p) => p.kind !== "fee").slice(0, 50);
    const paymentRows = shown.map((p) => [
      `<span class="secondary">${escapeHtml(formatTime(p.block_time))}</span>`,
      `<div>${amountHtml(p.amount, p.token, "−")}${feesByTx.has(p.tx_hash) ? `<div class="sub">+ ${escapeHtml(formatSmallAmount(feesByTx.get(p.tx_hash)!))} fee</div>` : ""}</div>`,
      recipientCell(p),
      reasonCell(p),
      txCell(p.tx_hash, config.explorerUrl),
    ]);

    const recipients = db.topRecipients(k.account, k.key_id);
    const approvals = db.listApprovals({ account: k.account, keyId: k.key_id, limit: 20 });
    const history = db.keyEvents(1000).filter((e) => e.account === k.account && e.key_id === k.key_id);
    const audit = db.listAudit({ account: k.account, keyId: k.key_id, limit: 50 });

    const op = operatorFor(k.account);
    const self = agentHref(k.account, k.key_id);
    const controls =
      status !== "active"
        ? `<p class="muted">This key is ${status}; it can no longer spend.</p>`
        : op
          ? `<form method="post" action="/admin/keys/${escapeHtml(k.account)}/${escapeHtml(k.key_id)}/limit" class="stack-form">
              <label>Set spending limit
                <span class="field-row">
                  <input type="text" name="limit" inputmode="decimal" required placeholder="500.00" pattern="\\d{1,15}(\\.\\d{1,6})?" aria-label="New limit">
                  <select name="token" aria-label="Token">${tokenOptions()}</select>
                  <button type="submit">Update limit</button>
                </span>
              </label>
              <p class="hint">Submits <span class="mono">updateSpendingLimit</span> on-chain; Tempo resets the remaining budget to the new limit.</p>
            </form>
            <form method="post" action="/admin/keys/${escapeHtml(k.account)}/${escapeHtml(k.key_id)}/revoke" class="stack-form"
                  data-confirm="Revoke this agent's key on-chain? It will immediately lose all ability to spend. This cannot be undone.">
              <button type="submit" class="danger">Revoke key</button>
              <p class="hint">Kill switch: <span class="mono">revokeKey</span> on-chain. Permanent.</p>
            </form>`
          : `<p class="muted">On-chain controls are off for this account. Set <span class="mono">OPERATOR_MODE</span> and an operator key (an admin access key) to revoke keys, change limits, and approve requests from here.</p>`;

    const stats = `
      <div class="stats stats-4">
        <div class="stat"><div class="stat-label">Remaining</div><div class="stat-value">${
          primaryHealth ? `${formatAmount(primaryHealth.remaining)}<span class="unit">${escapeHtml(primaryHealth.symbol)}</span>` : "—"
        }</div>${primaryHealth ? budgetBar(primaryHealth.pct, healthState(primaryHealth)) : ""}${
          primaryHealth?.pct != null ? `<div class="sub">${primaryHealth.pct.toFixed(0)}% of ≈${escapeHtml(formatAmount(primaryHealth.limit!))} limit</div>` : ""
        }</div>
        <div class="stat"><div class="stat-label">Spent (30 days)</div><div class="stat-value">${formatAmount(spent30)}<span class="unit">${escapeHtml(primary.symbol)}</span></div></div>
        <div class="stat"><div class="stat-label">Burn rate (7-day avg)</div><div class="stat-value">${formatAmount(burnPerDay)}<span class="unit">/ day</span></div></div>
        <div class="stat"><div class="stat-label">Runway</div><div class="stat-value">${
          runway === null ? "—" : runway > 365 ? "&gt; 1 yr" : `${runway}<span class="unit">days</span>`
        }</div>${primaryHealth && primaryHealth.periodEnd > 0 ? `<div class="sub">budget resets ${escapeHtml(formatTime(primaryHealth.periodEnd))}</div>` : ""}</div>
      </div>`;

    const body = `
      <p class="crumb"><a href="/">← Overview</a></p>
      <div class="title-row">
        <h1 class="page-title">${name ? escapeHtml(name) : `<span class="mono">${escapeHtml(shortAddress(k.key_id))}</span>`}</h1>
        ${statusBadge(status)}
      </div>
      <p class="page-sub mono wrap">key ${escapeHtml(k.key_id)} · account ${escapeHtml(k.account)}</p>
      ${agentLabelForm(k.account, k.key_id, name, self)}
      ${budgets.unavailable ? `<div class="flash flash-bad">Live budget unavailable: the RPC could not be reached.</div>` : ""}
      ${stats}
      <div class="grid-2">
        <div class="card"><div class="card-head"><span class="card-title">Daily spend</span><span class="card-note">last 30 days, fees included</span></div>
          <div class="pad">${spendChart(daily, 30, primary.symbol)}</div></div>
        <div class="card"><div class="card-head"><span class="card-title">Top recipients</span></div>
          ${
            recipients.length
              ? dataTable(
                  [{ label: "Recipient" }, { label: "Payments", num: true }, { label: "Total", num: true }],
                  recipients.map((r) => [
                    `<span class="mono">${escapeHtml(shortAddress(r.to_addr))}</span>`,
                    String(r.count),
                    amountHtml(r.total, primary.address),
                  ]),
                )
              : emptyState("No payments yet", "Recipients appear once the agent pays.")
          }</div>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-head"><span class="card-title">Controls</span><span class="card-note">${op ? `operator: ${escapeHtml(op.mode)} key` : "read-only"}</span></div>
          <div class="pad">${controls}</div></div>
        <div class="card"><div class="card-head"><span class="card-title">Budget requests</span><a class="card-note" href="/approvals">all requests →</a></div>
          ${
            approvals.length
              ? dataTable(
                  [{ label: "Requested" }, { label: "Amount", num: true }, { label: "Reason" }, { label: "Status" }],
                  approvals.map((a) => [
                    escapeHtml(relativeTime(a.created_time)),
                    amountHtml(a.amount, a.token, "+"),
                    `<span class="clamp" title="${escapeHtml(a.reason)}">${escapeHtml(a.reason)}</span>`,
                    approvalBadge(a),
                  ]),
                )
              : emptyState("No requests", "When this agent needs more budget, its requests appear here.")
          }</div>
      </div>
      <div class="card"><div class="card-head"><span class="card-title">Payments</span><span class="card-note">most recent first</span></div>
        ${
          shown.length
            ? dataTable(
                [{ label: "Time" }, { label: "Amount", num: true }, { label: "Recipient" }, { label: "Reason" }, { label: "Transaction" }],
                paymentRows,
              )
            : emptyState("No payments yet", "This agent hasn't spent anything.")
        }</div>
      <div class="grid-2">
        <div class="card"><div class="card-head"><span class="card-title">Key history</span><span class="card-note">on-chain</span></div>
          ${history.length ? dataTable([{ label: "Time" }, { label: "Event" }, { label: "Transaction" }], history.map((e) => [escapeHtml(formatTime(e.block_time)), escapeHtml(describeKeyEvent(e)), txCell(e.tx_hash, config.explorerUrl)])) : emptyState("No events", "")}</div>
        <div class="card"><div class="card-head"><span class="card-title">Operator actions</span><span class="card-note">from this dashboard</span></div>
          ${audit.length ? auditTable(audit) : emptyState("No operator actions", "Revocations, limit changes, and approvals made here are logged.")}</div>
      </div>`;
    return page(c, name ?? "Agent", "overview", body);
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
      <p class="page-sub">Every agent payment, joined with its on-chain transfer and the agent's stated reason.</p>
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
    const signer = p.reason ? await recoverSigner(p.reason.memo as Hex, p.reason.signature) : null;

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

  // ── Approvals ─────────────────────────────────────────────────────────────
  function approvalBadge(a: ApprovalRow): string {
    const status = approvalJson(a).status;
    const cls =
      status === "approved" ? "badge-active" : status === "denied" || status === "failed" ? "badge-revoked" : "badge-expired";
    const label =
      status === "approved" && !a.tx_hash ? "Approved (not executed)" : status.charAt(0).toUpperCase() + status.slice(1);
    return `<span class="badge ${status === "pending" ? "badge-pending" : cls}"><span class="dot"></span>${escapeHtml(label)}</span>`;
  }

  app.get("/approvals", async (c) => {
    const labels = db.listLabels();
    const pending = db.listApprovals({ status: "pending", limit: 100 }).filter((a) => !isExpired(a.created_time));
    const history = db.listApprovals({ limit: 100 }).filter((a) => a.status !== "pending" || isExpired(a.created_time));

    const cards = await Promise.all(
      pending.map(async (a) => {
        const key = db.getKey(a.account, a.key_id);
        const budgets = key ? await readBudgets(key) : { budgets: [], unavailable: true };
        const b = budgets.budgets.find((x) => x.token.toLowerCase() === a.token);
        const suggested = (b ? b.remaining : 0n) + BigInt(a.amount);
        const op = operatorFor(a.account);
        const keyActive = key ? keyStatus(key) === "active" : false;
        return `<div class="request">
          <div class="request-head">
            <div>${agentCell(labels, a.account, a.key_id)}</div>
            <div class="request-amount">${amountHtml(a.amount, a.token, "+")}</div>
          </div>
          <div class="reason-quote">${escapeHtml(a.reason)}</div>
          <dl class="facts compact">
            <dt>Requested</dt><dd>${escapeHtml(formatTime(a.created_time))}</dd>
            ${a.to_addr ? `<dt>For recipient</dt><dd class="mono wrap">${escapeHtml(a.to_addr)}</dd>` : ""}
            <dt>Remaining now</dt><dd>${b ? amountHtml(b.remaining, a.token) : budgets.unavailable ? `<span class="budget-error">unavailable</span>` : "—"}</dd>
          </dl>
          ${
            keyActive
              ? `<div class="request-actions">
            <form method="post" action="/admin/approvals/${escapeHtml(a.id)}/approve" class="inline-form"
                  data-confirm="${op ? "Raise this agent's on-chain spending limit?" : "Record approval? No operator key is configured, so you'll still need to raise the limit on-chain yourself."}">
              <label>New limit <input type="text" name="newLimit" value="${escapeHtml(formatUnits(suggested, 6))}" inputmode="decimal" required pattern="\\d{1,15}(\\.\\d{1,6})?" aria-label="New limit"></label>
              <button type="submit" class="primary">${op ? "Approve &amp; raise limit" : "Approve"}</button>
            </form>
            <form method="post" action="/admin/approvals/${escapeHtml(a.id)}/deny" class="inline-form">
              <input type="text" name="note" maxlength="200" placeholder="Reason for denying (optional)" aria-label="Denial note">
              <button type="submit">Deny</button>
            </form>
          </div>
          <p class="hint">${op ? "Approving submits <span class=\"mono\">updateSpendingLimit</span> on-chain with the operator key; Tempo resets remaining to the new limit." : "No operator key configured — approval is recorded; execute the limit change on-chain yourself."}</p>`
              : `<p class="muted">This key is no longer active.</p>`
          }
        </div>`;
      }),
    );

    const body = `
      <h1 class="page-title">Approvals</h1>
      <p class="page-sub">When an agent hits its on-chain limit it can ask for more. Approving raises the limit on-chain — never just a flag here.</p>
      <div class="card">
        <div class="card-head"><span class="card-title">Pending</span><span class="card-note">${pending.length} awaiting review</span></div>
        ${cards.length ? `<div class="requests">${cards.join("")}</div>` : emptyState("Nothing to review", "Agents' budget requests appear here.")}
      </div>
      <div class="card">
        <div class="card-head"><span class="card-title">History</span></div>
        ${
          history.length
            ? dataTable(
                [
                  { label: "Requested" },
                  { label: "Agent" },
                  { label: "Amount", num: true },
                  { label: "Reason" },
                  { label: "Status" },
                  { label: "New limit", num: true },
                  { label: "Transaction" },
                ],
                history.map((a) => [
                  `<span class="secondary">${escapeHtml(formatTime(a.created_time))}</span>`,
                  agentCell(labels, a.account, a.key_id),
                  amountHtml(a.amount, a.token, "+"),
                  `<span class="clamp" title="${escapeHtml(a.reason)}">${escapeHtml(a.reason)}</span>${a.note ? `<div class="sub">${escapeHtml(a.note)}</div>` : ""}`,
                  approvalBadge(a),
                  a.new_limit ? amountHtml(a.new_limit, a.token) : `<span class="muted">—</span>`,
                  a.tx_hash ? txCell(a.tx_hash, config.explorerUrl) : `<span class="muted">—</span>`,
                ]),
              )
            : emptyState("No decisions yet", "Approved and denied requests are kept here.")
        }
      </div>`;
    return page(c, "Approvals", "approvals", body);
  });

  // ── Keys ──────────────────────────────────────────────────────────────────
  app.get("/keys", (c) => {
    const events: KeyEventRow[] = db.keyEvents(200);
    const labels = db.listLabels();
    const rows = events.map((e) => [
      `<span class="secondary">${escapeHtml(formatTime(e.block_time))}</span>`,
      escapeHtml(describeKeyEvent(e)),
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

    const authorizeCard = writer
      ? `<div class="card"><div class="card-head"><span class="card-title">Authorize a new agent</span><span class="card-note">account ${escapeHtml(shortAddress(writer.account))} · operator: ${escapeHtml(writer.mode)} key</span></div>
          <form method="post" action="/admin/keys/authorize" class="pad grid-form">
            <label>Agent key address<input type="text" name="keyId" required pattern="0x[0-9a-fA-F]{40}" placeholder="0x… (generated by the agent: npm run new-agent-key)" class="mono"></label>
            <label>Name<input type="text" name="name" maxlength="64" placeholder="Research Agent"></label>
            <label>Budget<span class="field-row"><input type="text" name="limit" required inputmode="decimal" pattern="\\d{1,15}(\\.\\d{1,6})?" placeholder="500.00"><select name="token" aria-label="Token">${tokenOptions()}</select></span></label>
            <label>Resets<select name="period">${PERIODS.map((p) => `<option value="${p.value}"${p.value === 30 * 86_400 ? " selected" : ""}>${escapeHtml(p.label)}</option>`).join("")}</select></label>
            <label>Expires after (days, 0 = never)<input type="number" name="expiryDays" min="0" max="3650" value="90"></label>
            <div class="form-actions"><button type="submit" class="primary">Authorize on-chain</button>
              <p class="hint">Submits <span class="mono">authorizeKey</span> with the budget as a native Tempo spending limit. The agent keeps its private key; Agent Spend only ever sees the address.</p></div>
          </form></div>`
      : "";

    const audit = db.listAudit({ limit: 50 });
    const body = `
      <h1 class="page-title">Keys</h1>
      <p class="page-sub">Audit trail of every access-key policy change on watched accounts.</p>
      ${authorizeCard}
      <div class="card">
        <div class="card-head"><span class="card-title">Key history</span><span class="card-note">on-chain</span></div>
        ${table}
      </div>
      <div class="card">
        <div class="card-head"><span class="card-title">Operator actions</span><span class="card-note">made from this dashboard</span></div>
        ${audit.length ? auditTable(audit, labels) : emptyState("No operator actions yet", "Revocations, limit changes, authorizations, and approvals made here are logged.")}
      </div>`;
    return page(c, "Keys", "keys", body);
  });

  function describeKeyEvent(e: KeyEventRow): string {
    switch (e.kind) {
      case "authorized":
        return "Key authorized";
      case "revoked":
        return "Key revoked";
      case "limit_updated":
        return `Spending limit set to ${formatAmount(e.new_limit!)} ${symbolFor(e.token!)}`;
    }
  }

  function auditTable(rows: AuditRow[], labels?: Map<string, string>): string {
    const cols = [
      { label: "Time" },
      ...(labels ? [{ label: "Agent" }] : []),
      { label: "Action" },
      { label: "Result" },
      { label: "Transaction" },
    ];
    return dataTable(
      cols,
      rows.map((r) => [
        `<span class="secondary">${escapeHtml(formatTime(r.time))}</span><div class="sub">by ${escapeHtml(r.actor)}</div>`,
        ...(labels ? [r.account && r.key_id ? agentCell(labels, r.account, r.key_id) : `<span class="muted">—</span>`] : []),
        `${escapeHtml(r.action)}<div class="sub clamp">${escapeHtml(r.detail)}</div>`,
        r.ok ? `<span class="badge badge-active"><span class="dot"></span>OK</span>` : `<span class="badge badge-revoked"><span class="dot"></span>Failed</span>`,
        r.tx_hash ? txCell(r.tx_hash, config.explorerUrl) : `<span class="muted">—</span>`,
      ]),
    );
  }

  // ── Agent API (JSON) ──────────────────────────────────────────────────────
  app.route("/api/v1", createApi(config, db, reader, { notify }));

  // ── Admin: agent identity (Agent Spend's own data, never on-chain) ────────
  app.post("/agents/:account/:keyId/label", async (c) => {
    const params = addressParams(c);
    if (!params) return c.text("Invalid account or key address", 400);
    const body = await c.req.parseBody();
    const label = typeof body.label === "string" ? body.label : "";
    db.setLabel(params.account, params.keyId, label);
    const to = safeRedirect(body.redirect);
    return c.redirect(to === "/" ? "/" : withFlash(to, "labeled"));
  });

  // ── Admin: on-chain controls ──────────────────────────────────────────────
  app.post("/admin/keys/:account/:keyId/revoke", async (c) => {
    const params = addressParams(c);
    if (!params) return c.text("Invalid account or key address", 400);
    const back = `/agents/${params.account}/${params.keyId}`;
    const op = operatorFor(params.account);
    if (!op) return c.redirect(withFlash(back, "no_operator"));
    try {
      const tx = await op.revoke(params.keyId as Address);
      db.audit({ actor: actor(), action: "Revoke key", account: params.account, keyId: params.keyId, detail: "revokeKey", txHash: tx, ok: true });
      await indexer?.runOnce().catch(() => {});
      return c.redirect(withFlash(back, "revoked"));
    } catch (err) {
      db.audit({ actor: actor(), action: "Revoke key", account: params.account, keyId: params.keyId, detail: describeWriteError(err), ok: false });
      return c.redirect(withFlash(back, "failed"));
    }
  });

  app.post("/admin/keys/:account/:keyId/limit", async (c) => {
    const params = addressParams(c);
    if (!params) return c.text("Invalid account or key address", 400);
    const back = `/agents/${params.account}/${params.keyId}`;
    const body = await c.req.parseBody();
    const limit = parseTokenAmount(body.limit);
    const token = config.tokens.find((t) => t.address.toLowerCase() === String(body.token ?? "").toLowerCase());
    if (limit === null || !token) return c.redirect(withFlash(back, "invalid"));
    const op = operatorFor(params.account);
    if (!op) return c.redirect(withFlash(back, "no_operator"));
    const detail = `limit → ${formatAmount(limit)} ${token.symbol}`;
    try {
      const tx = await op.setLimit(params.keyId as Address, token.address, limit);
      db.audit({ actor: actor(), action: "Set spending limit", account: params.account, keyId: params.keyId, detail, txHash: tx, ok: true });
      await indexer?.runOnce().catch(() => {});
      return c.redirect(withFlash(back, "limit"));
    } catch (err) {
      db.audit({ actor: actor(), action: "Set spending limit", account: params.account, keyId: params.keyId, detail: `${detail}: ${describeWriteError(err)}`, ok: false });
      return c.redirect(withFlash(back, "failed"));
    }
  });

  app.post("/admin/keys/authorize", async (c) => {
    if (!writer) return c.redirect(withFlash("/keys", "no_operator"));
    const body = await c.req.parseBody();
    const keyId = String(body.keyId ?? "").trim();
    const limit = parseTokenAmount(body.limit);
    const token = config.tokens.find((t) => t.address.toLowerCase() === String(body.token ?? "").toLowerCase());
    const period = Number(body.period ?? 0);
    const expiryDays = Number(body.expiryDays ?? 0);
    if (
      !isAddress(keyId, { strict: false }) ||
      limit === null ||
      limit === 0n ||
      !token ||
      !PERIODS.some((p) => p.value === period) ||
      !Number.isInteger(expiryDays) ||
      expiryDays < 0 ||
      expiryDays > 3650
    ) {
      return c.redirect(withFlash("/keys", "invalid"));
    }
    const expiry = expiryDays > 0 ? Math.floor(Date.now() / 1000) + expiryDays * 86_400 : 0;
    const detail = `budget ${formatAmount(limit)} ${token.symbol}, ${PERIODS.find((p) => p.value === period)!.label.toLowerCase()}, ${expiryDays ? `expires in ${expiryDays}d` : "no expiry"}`;
    try {
      const tx = await writer.authorize({ keyId: keyId as Address, token: token.address, limit, period, expiry });
      const name = typeof body.name === "string" ? body.name : "";
      if (name.trim()) db.setLabel(writer.account, keyId, name);
      db.audit({ actor: actor(), action: "Authorize agent key", account: writer.account, keyId, detail, txHash: tx, ok: true });
      await indexer?.runOnce().catch(() => {});
      return c.redirect(withFlash("/keys", "authorized"));
    } catch (err) {
      db.audit({ actor: actor(), action: "Authorize agent key", account: writer.account, keyId, detail: `${detail}: ${describeWriteError(err)}`, ok: false });
      return c.redirect(withFlash("/keys", "failed"));
    }
  });

  app.post("/admin/approvals/:id/approve", async (c) => {
    const id = c.req.param("id");
    if (!/^0x[0-9a-fA-F]{64}$/.test(id)) return c.text("Invalid approval id", 400);
    const a = db.getApproval(id);
    if (!a) return c.redirect(withFlash("/approvals", "stale"));
    const body = await c.req.parseBody();
    const newLimit = parseTokenAmount(body.newLimit);
    if (newLimit === null || newLimit === 0n) return c.redirect(withFlash("/approvals", "invalid"));
    const key = db.getKey(a.account, a.key_id);
    if (a.status !== "pending" || isExpired(a.created_time) || !key || keyStatus(key) !== "active") {
      return c.redirect(withFlash("/approvals", "stale"));
    }
    // Atomic pending → approved claim: a double-submit can't execute twice.
    if (!db.claimApproval(a.id, actor())) return c.redirect(withFlash("/approvals", "stale"));

    const op = operatorFor(a.account);
    const detail = `+${formatAmount(a.amount)} ${symbolFor(a.token)} requested; limit → ${formatAmount(newLimit)}`;
    if (!op) {
      db.finishApproval(a.id, {
        status: "approved",
        newLimit: newLimit.toString(),
        note: "Approved; awaiting on-chain limit change by the owner",
      });
      db.audit({ actor: actor(), action: "Approve request (manual)", account: a.account, keyId: a.key_id, detail, ok: true });
      return c.redirect(withFlash("/approvals", "approved_manual"));
    }
    try {
      const tx = await op.setLimit(a.key_id as Address, a.token as Address, newLimit);
      db.finishApproval(a.id, { status: "approved", newLimit: newLimit.toString(), txHash: tx });
      db.audit({ actor: actor(), action: "Approve request", account: a.account, keyId: a.key_id, detail, txHash: tx, ok: true });
      await indexer?.runOnce().catch(() => {});
      return c.redirect(withFlash("/approvals", "approved"));
    } catch (err) {
      const msg = describeWriteError(err);
      db.finishApproval(a.id, { status: "failed", newLimit: newLimit.toString(), note: `On-chain update failed: ${msg}` });
      db.audit({ actor: actor(), action: "Approve request", account: a.account, keyId: a.key_id, detail: `${detail}: ${msg}`, ok: false });
      return c.redirect(withFlash("/approvals", "failed"));
    }
  });

  app.post("/admin/approvals/:id/deny", async (c) => {
    const id = c.req.param("id");
    if (!/^0x[0-9a-fA-F]{64}$/.test(id)) return c.text("Invalid approval id", 400);
    const a = db.getApproval(id);
    if (!a || a.status !== "pending") return c.redirect(withFlash("/approvals", "stale"));
    const body = await c.req.parseBody();
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : "";
    if (!db.claimApproval(a.id, actor())) return c.redirect(withFlash("/approvals", "stale"));
    db.finishApproval(a.id, { status: "denied", note: note || null });
    db.audit({
      actor: actor(),
      action: "Deny request",
      account: a.account,
      keyId: a.key_id,
      detail: `+${formatAmount(a.amount)} ${symbolFor(a.token)}${note ? `: ${note}` : ""}`,
      ok: true,
    });
    return c.redirect(withFlash("/approvals", "denied"));
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
      operator: writer ? writer.mode : null,
    });
  });

  return app;
}
