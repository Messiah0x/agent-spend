// Server-rendered UI. No client framework; one shared stylesheet. Inline
// <style>/<script> carry the per-request CSP nonce (see security.ts).

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const css = /* css */ `
:root {
  --bg: #f7f7f6;
  --surface: #ffffff;
  --border: #e8e7e4;
  --border-strong: #d9d8d4;
  --text: #171715;
  --text-secondary: #5c5b57;
  --text-muted: #8a8983;
  --accent: #171715;
  --good: #0ca30c;
  --good-bg: #eef8ee;
  --critical: #d03b3b;
  --critical-bg: #fbf0f0;
  --neutral-bg: #f0efec;
  --radius: 10px;
  --font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-text-size-adjust: 100%; }
body {
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
a { color: inherit; }

.topbar {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.topbar-inner {
  max-width: 1240px;
  margin: 0 auto;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 28px;
  height: 56px;
}
.brand {
  font-weight: 650;
  font-size: 15px;
  letter-spacing: -0.01em;
  display: flex;
  align-items: center;
  gap: 9px;
  text-decoration: none;
  white-space: nowrap;
  flex-shrink: 0;
}
.brand-mark {
  width: 22px; height: 22px;
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
}
.nav { display: flex; gap: 4px; height: 100%; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.nav::-webkit-scrollbar { display: none; }
.nav a {
  display: inline-flex;
  align-items: center;
  padding: 0 12px;
  white-space: nowrap;
  text-decoration: none;
  color: var(--text-secondary);
  font-weight: 500;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.nav a.active { color: var(--text); border-bottom-color: var(--accent); }
.nav a:hover { color: var(--text); }
.net {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.net-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--good); }

.page { max-width: 1240px; margin: 0 auto; padding: 28px 20px 64px; }
.page-title { font-size: 20px; font-weight: 650; letter-spacing: -0.02em; }
.page-sub { color: var(--text-secondary); margin-top: 2px; margin-bottom: 24px; }

.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}
.stat {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px 18px;
}
.stat-label { font-size: 12px; font-weight: 550; color: var(--text-secondary); }
.stat-value {
  font-size: 24px;
  font-weight: 650;
  letter-spacing: -0.02em;
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
}
.stat-value .unit { font-size: 14px; font-weight: 500; color: var(--text-muted); margin-left: 4px; }

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.card + .card { margin-top: 20px; }
.card-head {
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.card-title { font-size: 14px; font-weight: 620; }
.card-note { font-size: 12px; color: var(--text-muted); }

.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; white-space: nowrap; }
th {
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
td {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
tr:last-child td { border-bottom: none; }
tbody tr:hover { background: #fbfbfa; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }

.amount { font-weight: 600; font-variant-numeric: tabular-nums; }
.amount .sym { font-weight: 450; color: var(--text-muted); font-size: 12px; margin-left: 3px; }
.mono { font-family: var(--mono); font-size: 12.5px; }
.muted { color: var(--text-muted); }
.budget-error { color: var(--critical); }
.secondary { color: var(--text-secondary); }
.sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

.agent-name { font-weight: 620; }
.label-form { display: flex; gap: 6px; margin-top: 8px; }
.label-form input {
  font: inherit;
  font-size: 12px;
  padding: 4px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  width: 160px;
  background: var(--surface);
  color: var(--text);
}
.label-form button {
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  padding: 4px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
.label-form button:hover { background: var(--neutral-bg); }

.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 550;
  padding: 2px 9px 2px 7px;
  border-radius: 999px;
}
.badge .dot { width: 6px; height: 6px; border-radius: 50%; }
.badge-active { background: var(--good-bg); color: #086308; }
.badge-active .dot { background: var(--good); }
.badge-revoked { background: var(--critical-bg); color: #9c2626; }
.badge-revoked .dot { background: var(--critical); }
.badge-expired { background: var(--neutral-bg); color: var(--text-secondary); }
.badge-expired .dot { background: var(--text-muted); }

.chip-fee { background: var(--neutral-bg); color: var(--text-muted); font-family: var(--font); }
.fee-row td { color: var(--text-muted); }
.fee-row .amount { font-weight: 450; }
.chip {
  display: inline-block;
  background: var(--neutral-bg);
  border-radius: 6px;
  padding: 1px 7px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-secondary);
}

.crumb { margin-bottom: 10px; font-size: 13px; }
.crumb a { color: var(--text-secondary); text-decoration: none; }
.crumb a:hover { color: var(--text); }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
.grid-2 .card + .card { margin-top: 0; }
.pad { padding: 16px 18px; }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: 8px 16px; }
.facts dt { color: var(--text-muted); font-size: 12px; padding-top: 1px; }
.facts dd { min-width: 0; }
.proof { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border); display: grid; gap: 12px; }
.proof .facts { margin-top: 2px; }
.problems { color: var(--critical); padding-left: 18px; }
.reason-quote { font-size: 15px; line-height: 1.5; border-left: 3px solid var(--border-strong); padding-left: 12px; }
.wrap { overflow-wrap: anywhere; white-space: pre-wrap; }
details summary { cursor: pointer; color: var(--text-secondary); font-size: 12px; }
details pre { margin-top: 8px; background: var(--neutral-bg); border-radius: 6px; padding: 10px; font-size: 12px; }
.reason-cell { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 4px 8px; white-space: normal; min-width: 200px; max-width: 300px; }
.reason-link { text-decoration: none; border-bottom: 1px dotted var(--border-strong); }
.reason-link:hover { border-bottom-color: var(--text-muted); }
a.chip { text-decoration: none; }

.empty {
  padding: 48px 20px;
  text-align: center;
  color: var(--text-muted);
}
.empty-title { font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; }

.txlink { color: var(--text-secondary); text-decoration: none; border-bottom: 1px dotted var(--border-strong); }
.txlink:hover { color: var(--text); border-bottom-color: var(--text-muted); }

@media (max-width: 720px) {
  .topbar-inner { gap: 10px; padding: 0 14px; }
  .brand-text { display: none; }
  .nav a { padding: 0 9px; }
  .net { display: none; }
  .page { padding: 20px 14px 48px; }
  .stats { grid-template-columns: 1fr; }
  .grid-2 { grid-template-columns: 1fr; }
  .facts { grid-template-columns: 1fr; gap: 2px; }
  .facts dd { margin-bottom: 8px; }
  .reason-cell { white-space: normal; justify-content: flex-end; flex-wrap: wrap; }
  th, td { padding-left: 14px; padding-right: 14px; }
  .label-form input { width: 100%; min-width: 0; }

  /* Tables collapse into stacked cards: one row per card, each cell labeled. */
  table.responsive { white-space: normal; }
  table.responsive thead { display: none; }
  table.responsive tr { display: block; padding: 10px 0; border-bottom: 1px solid var(--border); }
  table.responsive tr:last-child { border-bottom: none; }
  table.responsive td {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    padding: 5px 14px;
    border-bottom: none;
    text-align: right;
  }
  table.responsive td::before {
    content: attr(data-label);
    flex-shrink: 0;
    text-align: left;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    padding-top: 2px;
  }
  table.responsive td[data-label=""]::before { content: none; }
  table.responsive td > * { max-width: 100%; }
  table.responsive td .label-form { justify-content: flex-end; }
}
`;

// Live refresh every 10s, but never while the operator is typing into a form
// (a reload would discard what they entered).
const refreshScript = /* js */ `
var dirty = false;
document.addEventListener("input", function () { dirty = true; });
setInterval(function () {
  var a = document.activeElement;
  var editing = a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT");
  if (!document.hidden && !editing && !dirty) location.reload();
}, 10000);
`;

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#171715"/><text x="16" y="22" font-family="system-ui,sans-serif" font-size="16" font-weight="700" fill="#fff" text-anchor="middle">A</text></svg>`,
  );

export interface NavContext {
  active: "overview" | "activity" | "keys";
  network: string;
}

export function layout(title: string, nav: NavContext, body: string, nonce: string): string {
  const tabs = [
    { href: "/", id: "overview", label: "Overview" },
    { href: "/activity", id: "activity", label: "Activity" },
    { href: "/keys", id: "keys", label: "Keys" },
  ];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="${FAVICON}">
<title>${escapeHtml(title)} · Agent Spend</title>
<style nonce="${nonce}">${css}</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <a class="brand" href="/" aria-label="Agent Spend home"><span class="brand-mark">A</span><span class="brand-text">Agent Spend</span></a>
    <nav class="nav">
      ${tabs
        .map(
          (t) =>
            `<a href="${t.href}"${t.id === nav.active ? ' class="active"' : ""}>${t.label}</a>`,
        )
        .join("")}
    </nav>
    <span class="net"><span class="net-dot"></span>${escapeHtml(nav.network)}</span>
  </div>
</header>
<main class="page">
${body}
</main>
<script nonce="${nonce}">${refreshScript}</script>
</body>
</html>`;
}

export function statusBadge(status: "active" | "revoked" | "expired"): string {
  const label = status === "active" ? "Active" : status === "revoked" ? "Revoked" : "Expired";
  return `<span class="badge badge-${status}"><span class="dot"></span>${label}</span>`;
}

export function emptyState(title: string, note: string): string {
  return `<div class="empty"><div class="empty-title">${escapeHtml(title)}</div>${escapeHtml(note)}</div>`;
}

export interface Column {
  label: string;
  num?: boolean;
}

/**
 * Standard data table. Cells are pre-rendered (and pre-escaped) HTML. Each
 * cell carries its column label so the table can collapse into labeled cards
 * on narrow screens. `rowClass` optionally styles individual rows.
 */
export function dataTable(cols: Column[], rows: string[][], rowClass?: (i: number) => string | undefined): string {
  const head = cols.map((c) => `<th${c.num ? ' class="num"' : ""}>${escapeHtml(c.label)}</th>`).join("");
  const body = rows
    .map((cells, i) => {
      const cls = rowClass?.(i);
      const tds = cells
        .map((html, j) => {
          const col = cols[j]!;
          return `<td data-label="${escapeHtml(col.label)}"${col.num ? ' class="num"' : ""}>${html}</td>`;
        })
        .join("");
      return `<tr${cls ? ` class="${cls}"` : ""}>${tds}</tr>`;
    })
    .join("");
  return `<div class="table-wrap"><table class="responsive"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
