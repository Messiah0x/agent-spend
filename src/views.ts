// Shared server-rendered fragments. Every dynamic value is escaped here or by
// the caller; nothing uses inline style attributes (the CSP forbids them), so
// dynamic geometry (bars, charts) is drawn with SVG presentation attributes.

import type { EnrichedPayment } from "./api.js";
import { formatAmount, shortAddress, shortHash, shortMemo } from "./format.js";
import { escapeHtml } from "./ui.js";

export function txCell(txHash: string, explorerUrl?: string): string {
  const label = `<span class="mono">${escapeHtml(shortHash(txHash))}</span>`;
  if (!explorerUrl) return label;
  const href = `${explorerUrl.replace(/\/$/, "")}/tx/${txHash}`;
  return `<a class="txlink" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

export function agentHref(account: string, keyId: string): string {
  return `/agents/${escapeHtml(account)}/${escapeHtml(keyId)}`;
}

/**
 * Agent identity cell: the human-readable name if one has been set (address
 * demoted to a secondary line), otherwise the address alone. Links to the
 * agent's page.
 */
export function agentCell(labels: Map<string, string>, account: string, keyId: string): string {
  const name = labels.get(`${account}|${keyId}`);
  const addr = `<span class="mono">${escapeHtml(shortAddress(keyId))}</span>`;
  const href = agentHref(account, keyId);
  return name
    ? `<div><a class="agent-link" href="${href}"><span class="agent-name">${escapeHtml(name)}</span></a><div class="sub">${addr}</div></div>`
    : `<a class="agent-link" href="${href}">${addr}</a>`;
}

/** Inline name/rename form. */
export function agentLabelForm(account: string, keyId: string, current: string | undefined, redirect = "/"): string {
  return `<form method="post" action="/agents/${escapeHtml(account)}/${escapeHtml(keyId)}/label" class="label-form">
    <input type="hidden" name="redirect" value="${escapeHtml(redirect)}">
    <input type="text" name="label" value="${escapeHtml(current ?? "")}" placeholder="Name this agent" maxlength="64" aria-label="Agent name">
    <button type="submit">${current ? "Rename" : "Save"}</button>
  </form>`;
}

export function verdictBadge(verdict: EnrichedPayment["verdict"]): string {
  if (verdict === "verified") {
    return `<span class="badge badge-active" title="The on-chain payment matches the signed reason record exactly"><span class="dot"></span>Verified</span>`;
  }
  if (verdict === "mismatch") {
    return `<span class="badge badge-revoked" title="The on-chain payment differs from what the agent's signed reason describes"><span class="dot"></span>Mismatch</span>`;
  }
  return "";
}

export function recipientCell(p: EnrichedPayment): string {
  if (p.kind === "payment" && p.to_addr) return `<span class="mono">${escapeHtml(shortAddress(p.to_addr))}</span>`;
  if (p.kind === "fee") {
    return `<span class="chip chip-fee" title="Per-transaction fee debited from this key's spending limit">network fee</span>`;
  }
  return `<span class="chip chip-fee" title="Budget debit with no matching token transfer">other debit</span>`;
}

/** Reason text (linked to the payment's proof page) or the raw memo chip when none is on file. */
export function reasonCell(p: EnrichedPayment): string {
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

/** Remaining-budget bar (SVG — no inline styles under the CSP). */
export function budgetBar(pct: number | null, state: "ok" | "low" | "exhausted"): string {
  if (pct === null) return "";
  const w = Math.max(0, Math.min(100, pct));
  return `<svg class="bar bar-${state}" viewBox="0 0 100 6" preserveAspectRatio="none" role="img" aria-label="${w.toFixed(0)}% of budget remaining">
    <rect class="bar-track" x="0" y="0" width="100" height="6" rx="3"/>
    <rect class="bar-fill" x="0" y="0" width="${w.toFixed(2)}" height="6" rx="3"/>
  </svg>`;
}

/** Daily spend bars for the last `days` days (UTC). */
export function spendChart(daily: Map<string, bigint>, days: number, symbol: string, now = Date.now()): string {
  const series: { day: string; v: bigint }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
    series.push({ day, v: daily.get(day) ?? 0n });
  }
  const max = series.reduce((m, s) => (s.v > m ? s.v : m), 0n);
  if (max === 0n) return `<div class="empty compact">No spend in the last ${days} days.</div>`;
  const W = 600;
  const H = 120;
  const gap = 3;
  const bw = (W - gap * (days - 1)) / days;
  const bars = series
    .map((s, i) => {
      const h = s.v === 0n ? 0 : Math.max(2, Number((s.v * 1000n) / max) / 1000 * (H - 4));
      const x = i * (bw + gap);
      return `<rect class="chart-bar" x="${x.toFixed(1)}" y="${(H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${escapeHtml(s.day)}: ${escapeHtml(formatAmount(s.v))} ${escapeHtml(symbol)}</title></rect>`;
    })
    .join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Daily spend, last ${days} days">
    <line class="chart-base" x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}"/>${bars}
  </svg>
  <div class="chart-axis"><span>${escapeHtml(series[0]!.day)}</span><span>peak ${escapeHtml(formatAmount(max))} ${escapeHtml(symbol)}/day</span><span>today</span></div>`;
}

/**
 * Result banners after an operator action. Only fixed messages keyed by code
 * are rendered — never text from the URL — so a crafted link can't display
 * arbitrary content on the dashboard.
 */
const FLASH: Record<string, { tone: "good" | "bad"; text: string }> = {
  labeled: { tone: "good", text: "Agent name saved." },
  revoked: { tone: "good", text: "Key revoked on-chain. The agent can no longer spend." },
  limit: { tone: "good", text: "Spending limit updated on-chain." },
  authorized: { tone: "good", text: "New agent key authorized on-chain." },
  approved: { tone: "good", text: "Approved — the new limit is live on-chain." },
  approved_manual: {
    tone: "good",
    text: "Approval recorded. No operator key is configured, so the owner must still raise the limit on-chain.",
  },
  denied: { tone: "good", text: "Request denied. The agent will see the decision." },
  failed: { tone: "bad", text: "The on-chain transaction failed — see Operator actions for details." },
  stale: { tone: "bad", text: "That request was already decided or has expired." },
  invalid: { tone: "bad", text: "Invalid input — check the amounts and addresses." },
  no_operator: { tone: "bad", text: "On-chain controls are disabled: no operator key is configured for this account." },
};

export function flashBanner(code: string | undefined): string {
  const f = code ? FLASH[code] : undefined;
  return f ? `<div class="flash flash-${f.tone}" role="status">${escapeHtml(f.text)}</div>` : "";
}
