import { Hono } from "hono";
import type { Address } from "viem";
import type { Config } from "./config.js";
import type { Db, KeyRow, PaymentRow, KeyEventRow } from "./db.js";
import type { Reader } from "./reads.js";
import {
  formatAmount,
  formatTime,
  relativeTime,
  shortAddress,
  shortHash,
  shortMemo,
} from "./format.js";
import { layout, statusBadge, emptyState, escapeHtml, type NavContext } from "./ui.js";

function keyStatus(k: KeyRow, now = Math.floor(Date.now() / 1000)) {
  if (k.revoked_block !== null) return "revoked" as const;
  if (k.expiry !== 0 && k.expiry < now) return "expired" as const;
  return "active" as const;
}

function txCell(txHash: string, explorerUrl?: string): string {
  const label = `<span class="mono">${escapeHtml(shortHash(txHash))}</span>`;
  if (!explorerUrl) return label;
  const href = `${explorerUrl.replace(/\/$/, "")}/tx/${txHash}`;
  return `<a class="txlink" href="${escapeHtml(href)}" target="_blank" rel="noopener">${label}</a>`;
}

export function createServer(config: Config, db: Db, reader: Reader) {
  const app = new Hono();
  const network =
    config.chainId === 42431 ? "Tempo Moderato" : config.chainId === 4217 ? "Tempo" : `Chain ${config.chainId}`;
  const symbolFor = (token: string) =>
    config.tokens.find((t) => t.address.toLowerCase() === token.toLowerCase())?.symbol ??
    shortAddress(token);
  const nav = (active: NavContext["active"]): NavContext => ({ active, network });

  const amountHtml = (baseUnits: string | bigint, token: string, sign = "") =>
    `<span class="amount">${sign}${formatAmount(baseUnits)}<span class="sym">${escapeHtml(symbolFor(token))}</span></span>`;

  // ── Overview ──────────────────────────────────────────────────────────────
  app.get("/", async (c) => {
    const keys = db.listKeys();
    const totals = db.spendTotals();
    const lastSpends = db.lastSpendTimes();

    const budgets = await Promise.all(
      keys.map((k) =>
        keyStatus(k) === "active"
          ? reader.remainingBudgets(k.account as Address, k.key_id as Address)
          : Promise.resolve([]),
      ),
    );

    const activeCount = keys.filter((k) => keyStatus(k) === "active").length;
    let totalSpent = 0n;
    for (const v of totals.values()) totalSpent += v;
    const primarySymbol = config.tokens[0]?.symbol ?? "";

    const rows = keys
      .map((k, i) => {
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
            : budgets[i]!.length
              ? budgets[i]!
                  .map((b) => {
                    const resets =
                      b.periodEnd > 0
                        ? `<div class="sub">resets ${escapeHtml(formatTime(b.periodEnd))}</div>`
                        : "";
                    return `${amountHtml(b.remaining, b.token)}${resets}`;
                  })
                  .join("<br>")
              : `<span class="muted">no limit set</span>`;

        const last = lastSpends.get(`${k.account}|${k.key_id}`);
        return `<tr>
          <td>
            <span class="mono">${escapeHtml(shortAddress(k.key_id))}</span>
            <div class="sub">account ${escapeHtml(shortAddress(k.account))}</div>
          </td>
          <td>${statusBadge(status)}</td>
          <td class="num">${budgetHtml}</td>
          <td class="num">${spentHtml}</td>
          <td>${last ? escapeHtml(relativeTime(last)) : `<span class="muted">never</span>`}</td>
        </tr>`;
      })
      .join("");

    const table = keys.length
      ? `<div class="table-wrap"><table>
          <thead><tr>
            <th>Agent key</th><th>Status</th><th class="num">Remaining budget</th><th class="num">Total spent</th><th>Last active</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`
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
    return c.html(layout("Overview", nav("overview"), body));
  });

  // ── Activity ──────────────────────────────────────────────────────────────
  app.get("/activity", (c) => {
    const payments: PaymentRow[] = db.listPayments(200);
    const rows = payments
      .map((p) => {
        const memo = shortMemo(p.memo);
        return `<tr>
          <td><span class="secondary">${escapeHtml(formatTime(p.block_time))}</span></td>
          <td><span class="mono">${escapeHtml(shortAddress(p.key_id))}</span></td>
          <td class="num">${amountHtml(p.amount, p.token, "−")}</td>
          <td>${p.to_addr ? `<span class="mono">${escapeHtml(shortAddress(p.to_addr))}</span>` : `<span class="muted">—</span>`}</td>
          <td>${memo ? `<span class="chip" title="${escapeHtml(p.memo!)}">${escapeHtml(memo)}</span>` : `<span class="muted">—</span>`}</td>
          <td class="num">${amountHtml(p.remaining, p.token)}</td>
          <td>${txCell(p.tx_hash, config.explorerUrl)}</td>
        </tr>`;
      })
      .join("");

    const table = payments.length
      ? `<div class="table-wrap"><table>
          <thead><tr>
            <th>Time</th><th>Agent key</th><th class="num">Amount</th><th>Recipient</th><th>Memo</th><th class="num">Remaining after</th><th>Transaction</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`
      : emptyState("No payments yet", "Agent payments appear here as soon as they settle on-chain.");

    const body = `
      <h1 class="page-title">Activity</h1>
      <p class="page-sub">Every access-key payment, joined with its on-chain transfer.</p>
      <div class="card">
        <div class="card-head"><span class="card-title">Payments</span><span class="card-note">most recent first</span></div>
        ${table}
      </div>`;
    return c.html(layout("Activity", nav("activity"), body));
  });

  // ── Keys ──────────────────────────────────────────────────────────────────
  app.get("/keys", (c) => {
    const events: KeyEventRow[] = db.keyEvents(200);
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
    const rows = events
      .map(
        (e) => `<tr>
          <td><span class="secondary">${escapeHtml(formatTime(e.block_time))}</span></td>
          <td>${escapeHtml(describe(e))}</td>
          <td><span class="mono">${escapeHtml(shortAddress(e.key_id))}</span></td>
          <td><span class="mono muted">${escapeHtml(shortAddress(e.account))}</span></td>
          <td>${e.tx_hash ? txCell(e.tx_hash, config.explorerUrl) : ""}</td>
        </tr>`,
      )
      .join("");

    const table = events.length
      ? `<div class="table-wrap"><table>
          <thead><tr>
            <th>Time</th><th>Event</th><th>Agent key</th><th>Account</th><th>Transaction</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`
      : emptyState("No key events yet", "Key authorizations, revocations, and limit changes appear here.");

    const body = `
      <h1 class="page-title">Keys</h1>
      <p class="page-sub">Audit trail of every access-key policy change on watched accounts.</p>
      <div class="card">
        <div class="card-head"><span class="card-title">Key history</span></div>
        ${table}
      </div>`;
    return c.html(layout("Keys", nav("keys"), body));
  });

  app.get("/healthz", (c) => {
    const cursor = db.getCursor();
    return c.json({ ok: true, lastIndexedBlock: cursor === null ? null : Number(cursor) });
  });

  return app;
}
