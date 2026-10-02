// Server-rendered UI. No client framework; one shared stylesheet. Inline
// <style>/<script> carry the per-request CSP nonce (see security.ts).

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const css = /* css */ `
:root {
  color-scheme: dark;
  --bg: #242a31;
  --surface: #2b323a;
  --surface-2: #313943;
  --surface-hover: #37414c;
  --border: #3a434d;
  --border-strong: #4a5663;
  --text: #f3f6f8;
  --text-secondary: #c3cbd3;
  --text-muted: #8f9aa6;
  --accent: #58a6ff;
  --accent-soft: rgba(88,166,255,.14);
  --teal: #52d0bd;
  --good: #52d0bd;
  --good-bg: rgba(82,208,189,.12);
  --critical: #ff7070;
  --critical-bg: rgba(255,112,112,.12);
  --neutral-bg: #353e48;
  --warn: #f3b94f;
  --warn-bg: rgba(243,185,79,.12);
  --radius: 12px;
  --font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
  --dock: 72px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-text-size-adjust: 100%; }
body { font-family: var(--font); background: var(--bg); color: var(--text); font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
a { color: inherit; }

.topbar { position: fixed; inset: 0 auto 0 0; width: var(--dock); background: #20262d; border-right: 1px solid var(--border); z-index: 20; }
.topbar-inner { height: 100%; padding: 18px 10px; display: flex; flex-direction: column; align-items: center; gap: 16px; overflow: visible; }
.brand { display: flex; align-items: center; justify-content: center; text-decoration: none; margin-bottom: 12px; }
.brand-mark { width: 36px; height: 36px; border-radius: 11px; background: var(--accent); color: #102031; display: inline-flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 800; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
.brand-text { display: none; }
.nav { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; overflow: visible; }
.nav a { position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; border-radius: 12px; text-decoration: none; color: var(--text-muted); transition: transform 150ms ease, color 150ms ease, background 150ms ease; }
.nav a:hover, .nav a:focus-visible { transform: scale(1.16); color: var(--text); background: var(--surface-hover); z-index: 3; }
.nav a.active { color: var(--accent); background: var(--accent-soft); }
.nav a.active::before { content: ""; position: absolute; left: -10px; width: 3px; height: 20px; border-radius: 4px; background: var(--accent); }
.nav-icon { width: 21px; height: 21px; display: grid; place-items: center; font-size: 18px; font-weight: 700; }
.nav-label { pointer-events: none; position: absolute; left: 54px; top: 50%; transform: translate(8px,-50%); opacity: 0; padding: 6px 10px; border: 1px solid var(--border); border-radius: 8px; background: #171c22; color: var(--text); font-size: 12px; font-weight: 600; white-space: nowrap; box-shadow: 0 8px 28px rgba(0,0,0,.28); transition: opacity 130ms ease, transform 130ms ease; }
.nav a:hover .nav-label, .nav a:focus-visible .nav-label { opacity: 1; transform: translate(0,-50%); }
.nav-count { position: absolute; top: 3px; right: 1px; display: inline-flex; align-items: center; justify-content: center; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 999px; background: var(--warn); color: #1f252c; font-size: 10px; font-weight: 750; }
.net { margin-top: auto; writing-mode: vertical-rl; transform: rotate(180deg); font-size: 10px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
.net-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--good); }

.page { max-width: 1380px; margin: 0 auto; padding: 34px 30px 72px calc(var(--dock) + 30px); }
.page-title { font-size: 24px; font-weight: 680; letter-spacing: -0.025em; }
.page-sub { color: var(--text-secondary); margin-top: 3px; margin-bottom: 26px; }
.stats { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; margin-bottom: 24px; }
.stats-4 { grid-template-columns: repeat(4,1fr); }
.stat, .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: 0 10px 30px rgba(0,0,0,.08); }
.stat { padding: 17px 18px; }
.stat-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
.stat-value { font-size: 25px; font-weight: 680; letter-spacing: -.025em; margin-top: 4px; font-variant-numeric: tabular-nums; }
.stat-value .unit { font-size: 13px; font-weight: 500; color: var(--text-muted); margin-left: 4px; }
.card { overflow: hidden; }
.card + .card { margin-top: 20px; }
.card-head { padding: 14px 18px; border-bottom: 1px solid var(--border); display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.card-title { font-size: 14px; font-weight: 650; }
.card-note { font-size: 12px; color: var(--text-muted); }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; white-space: nowrap; }
th { text-align: left; font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--surface-2); }
td { padding: 12px 14px; border-bottom: 1px solid var(--border); vertical-align: top; }
tr:last-child td { border-bottom: none; }
tbody tr:hover { background: var(--surface-hover); }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.amount { font-weight: 650; font-variant-numeric: tabular-nums; }.amount .sym { font-weight: 450; color: var(--text-muted); font-size: 12px; margin-left: 3px; }
.mono { font-family: var(--mono); font-size: 12.5px; }.muted { color: var(--text-muted); }.budget-error,.problems { color: var(--critical); }.secondary { color: var(--text-secondary); }.sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
.agent-name { font-weight: 650; }.agent-link { text-decoration: none; }.agent-link:hover .agent-name,a.agent-link:hover>.mono { text-decoration: underline; text-underline-offset: 2px; }
.label-form { display:flex; gap:6px; margin-top:8px; margin-bottom:4px; }
.label-form input,input[type="text"],input[type="number"],select { font:inherit; font-size:13px; padding:6px 9px; border:1px solid var(--border-strong); border-radius:7px; background:#252c34; color:var(--text); min-width:0; }
.label-form input { font-size:12px; padding:4px 8px; width:160px; }
button,.label-form button { font:inherit; font-size:13px; font-weight:600; padding:6px 12px; border:1px solid var(--border-strong); border-radius:7px; background:var(--surface-2); color:var(--text); cursor:pointer; }
.label-form button { font-size:12px; padding:4px 10px; } button:hover,.label-form button:hover { background:var(--surface-hover); }
button.primary { background:var(--accent); color:#102031; border-color:var(--accent); } button.primary:hover { filter:brightness(1.08); } button.danger { color:var(--critical); }
input:focus-visible,select:focus-visible,button:focus-visible,a:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.badge { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; padding:2px 9px 2px 7px; border-radius:999px; }.badge .dot { width:6px;height:6px;border-radius:50%; }.badge-active { background:var(--good-bg); color:#7ee3d4; }.badge-active .dot { background:var(--good); }.badge-revoked { background:var(--critical-bg); color:#ff9b9b; }.badge-revoked .dot { background:var(--critical); }.badge-expired,.chip-fee,.chip { background:var(--neutral-bg); color:var(--text-secondary); }.badge-expired .dot { background:var(--text-muted); }
.chip { display:inline-block; border-radius:6px; padding:1px 7px; font-family:var(--mono); font-size:12px; }.chip-fee { font-family:var(--font); }.fee-row td { color:var(--text-muted); }.fee-row .amount { font-weight:450; }
.crumb { margin-bottom:10px; font-size:13px; }.crumb a { color:var(--text-secondary); text-decoration:none; }.crumb a:hover { color:var(--text); }
.grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:20px; align-items:start; }.grid-2 .card+.card { margin-top:0; }.grid-2+.card,.card+.grid-2,.grid-2+.grid-2,.stats+.grid-2 { margin-top:20px; }.stats+.card { margin-top:0; }.pad { padding:16px 18px; }
.facts { display:grid; grid-template-columns:max-content 1fr; gap:8px 16px; }.facts dt { color:var(--text-muted); font-size:12px; padding-top:1px; }.facts dd { min-width:0; }.facts.compact { gap:4px 14px; font-size:13px; }
.proof { margin-top:14px; padding-top:14px; border-top:1px solid var(--border); display:grid; gap:12px; }.problems { padding-left:18px; }.reason-quote { font-size:15px; line-height:1.5; border-left:3px solid var(--border-strong); padding-left:12px; }.wrap { overflow-wrap:anywhere; white-space:pre-wrap; }details summary { cursor:pointer; color:var(--text-secondary); font-size:12px; }details pre { margin-top:8px; background:var(--neutral-bg); border-radius:6px; padding:10px; font-size:12px; }
.reason-cell { display:flex; align-items:flex-start; flex-wrap:wrap; gap:4px 8px; white-space:normal; min-width:200px; max-width:300px; }.reason-link,.txlink { text-decoration:none; border-bottom:1px dotted var(--border-strong); }.txlink { color:var(--text-secondary); }
.flash { border-radius:var(--radius); padding:10px 14px; margin-bottom:18px; font-weight:550; border:1px solid; }.flash-good { background:var(--good-bg); color:#8ae8da; border-color:rgba(82,208,189,.35); }.flash-bad { background:var(--critical-bg); color:#ff9b9b; border-color:rgba(255,112,112,.35); }
.attention { border-color:rgba(243,185,79,.35); }.attention .card-head { background:var(--warn-bg); }.attention-list { list-style:none; }.attention-list li { display:flex; align-items:center; gap:10px; padding:10px 18px; border-bottom:1px solid var(--border); flex-wrap:wrap; }.attention-list li:last-child { border-bottom:none; }
.dot-low,.dot-exhausted,.dot-ok { width:8px;height:8px;border-radius:50%;flex-shrink:0; }.dot-low { background:var(--warn); }.dot-exhausted { background:var(--critical); }.dot-ok { background:var(--good); }
.budget { display:inline-grid; justify-items:end; gap:3px; }.bar { width:120px; height:6px; display:block; }.stat .bar { width:100%; margin-top:8px; }.bar-track { fill:var(--neutral-bg); }.bar-ok .bar-fill { fill:var(--good); }.bar-low .bar-fill { fill:var(--warn); }.bar-exhausted .bar-fill { fill:var(--critical); }.pct { font-size:11px;font-weight:650;padding:0 5px;border-radius:4px; }.pct-ok { color:#7ee3d4;background:var(--good-bg); }.pct-low { color:#ffd47f;background:var(--warn-bg); }.pct-exhausted { color:#ff9b9b;background:var(--critical-bg); }
.chart { width:100%; height:120px; display:block; }.chart-bar { fill:var(--accent); opacity:.78; }.chart-bar:hover { opacity:1; }.chart-base { stroke:var(--border-strong);stroke-width:1; }.chart-axis { display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-top:6px; }
.clamp { display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:normal;max-width:340px; }.hint { font-size:12px;color:var(--text-muted);margin-top:6px; }.stack-form+.stack-form { margin-top:18px;padding-top:18px;border-top:1px solid var(--border); }.stack-form label,.grid-form label { display:grid;gap:6px;font-size:12px;font-weight:600;color:var(--text-secondary); }.field-row { display:flex;gap:6px;flex-wrap:wrap; }.stack-form input[type="text"] { width:150px; }.grid-form { display:grid;grid-template-columns:2fr 1fr;gap:14px 18px; }.grid-form label:first-child { grid-column:1/-1; }.grid-form input[type="text"],.grid-form input[type="number"],.grid-form select { width:100%; }.grid-form .field-row input { flex:1; }.grid-form .field-row select { width:auto; }.form-actions { grid-column:1/-1;display:flex;align-items:center;gap:14px;flex-wrap:wrap; }.form-actions .hint { margin-top:0;flex:1;min-width:220px; }
.requests { display:grid; }.request { padding:16px 18px;border-bottom:1px solid var(--border);display:grid;gap:10px; }.request:last-child { border-bottom:none; }.request-head { display:flex;justify-content:space-between;align-items:flex-start;gap:12px; }.request-amount .amount { font-size:18px; }.request-actions { display:flex;gap:10px 20px;flex-wrap:wrap;align-items:flex-end; }.inline-form { display:flex;gap:6px;align-items:flex-end;flex-wrap:wrap; }.inline-form label { display:grid;gap:4px;font-size:12px;color:var(--text-secondary);font-weight:600; }.inline-form input[type="text"] { width:150px; }.inline-form input[name="note"] { width:240px; }.badge-pending { background:var(--warn-bg);color:#ffd47f; }.badge-pending .dot { background:var(--warn); }
.empty { padding:48px 20px;text-align:center;color:var(--text-muted); }.empty-title { font-weight:650;color:var(--text-secondary);margin-bottom:4px; }.empty.compact { padding:24px 12px; }

@media (max-width:720px) {
  :root { --dock: 0px; }
  .topbar { inset:auto 0 0 0; width:auto; height:64px; border-right:none; border-top:1px solid var(--border); }
  .topbar-inner { height:64px; padding:7px 12px; flex-direction:row; justify-content:center; }
  .brand,.net { display:none; }
  .nav { width:100%; flex-direction:row; justify-content:space-around; gap:2px; }
  .nav a { width:52px; height:48px; flex-direction:column; gap:2px; transform:none !important; background:transparent !important; }
  .nav a.active::before { left:50%; top:-7px; width:22px; height:3px; transform:translateX(-50%); }
  .nav-icon { font-size:17px; height:20px; }
  .nav-label { position:static; opacity:1; transform:none; padding:0; border:0; background:transparent; box-shadow:none; font-size:9px; color:inherit; }
  .nav-count { top:0; right:3px; }
  .page { padding:22px 14px 92px; }
  .stats,.stats-4 { grid-template-columns:1fr 1fr; }
  .stat-value { font-size:20px; }
  .grid-form,.grid-2 { grid-template-columns:1fr; }
  .request-actions,.inline-form { width:100%; }.inline-form input[type="text"],.inline-form input[name="note"] { flex:1;width:auto; }.bar { width:100px; }.clamp { max-width:100%; }.facts { grid-template-columns:1fr;gap:2px; }.facts dd { margin-bottom:8px; }.reason-cell { white-space:normal;justify-content:flex-end;flex-wrap:wrap; }th,td { padding-left:14px;padding-right:14px; }.label-form input { width:100%;min-width:0; }
  table.responsive { white-space:normal; } table.responsive thead { display:none; } table.responsive tr { display:block;padding:10px 0;border-bottom:1px solid var(--border); } table.responsive tr:last-child { border-bottom:none; } table.responsive td { display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:5px 14px;border-bottom:none;text-align:right; } table.responsive td::before { content:attr(data-label);flex-shrink:0;text-align:left;font-size:11px;font-weight:650;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);padding-top:2px; } table.responsive td[data-label=""]::before { content:none; } table.responsive td>* { max-width:100%; } table.responsive td .label-form { justify-content:flex-end; }
}
`;

const refreshScript = /* js */ `
document.addEventListener("submit", function (e) {
  var msg = e.target.getAttribute && e.target.getAttribute("data-confirm");
  if (msg && !window.confirm(msg)) e.preventDefault();
});
if (location.search.indexOf("flash=") !== -1) history.replaceState(null, "", location.pathname);
var dirty = false;
document.addEventListener("input", function () { dirty = true; });
setInterval(function () {
  var a = document.activeElement;
  var editing = a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT");
  if (!document.hidden && !editing && !dirty) location.reload();
}, 10000);
`;

const FAVICON = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#242a31"/><path d="M7 9h18l-9 15z" fill="#58a6ff"/></svg>`);

export interface NavContext {
  active: "overview" | "activity" | "approvals" | "keys";
  network: string;
  pendingApprovals?: number;
}

const icons: Record<NavContext["active"], string> = { overview: "⌂", activity: "≡", approvals: "✓", keys: "▣" };

export function layout(title: string, nav: NavContext, body: string, nonce: string): string {
  const tabs: { href:string; id:NavContext["active"]; label:string }[] = [
    { href: "/", id: "overview", label: "Overview" },
    { href: "/activity", id: "activity", label: "Activity" },
    { href: "/approvals", id: "approvals", label: "Approvals" },
    { href: "/keys", id: "keys", label: "Keys" },
  ];
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#242a31"><link rel="icon" href="${FAVICON}"><title>${escapeHtml(title)} · Agent Spend</title><style nonce="${nonce}">${css}</style></head>
<body>
<header class="topbar"><div class="topbar-inner">
<a class="brand" href="/" aria-label="Agent Spend home"><span class="brand-mark">A</span><span class="brand-text">Agent Spend</span></a>
<nav class="nav" aria-label="Primary navigation">${tabs.map((t)=>`<a href="${t.href}" aria-label="${t.label}"${t.id===nav.active?' class="active" aria-current="page"':''}><span class="nav-icon" aria-hidden="true">${icons[t.id]}</span><span class="nav-label">${t.label}</span>${t.id==="approvals"&&nav.pendingApprovals?`<span class="nav-count" aria-label="${nav.pendingApprovals} pending">${nav.pendingApprovals}</span>`:""}</a>`).join("")}</nav>
<span class="net"><span class="net-dot"></span>${escapeHtml(nav.network)}</span>
</div></header>
<main class="page">${body}</main><script nonce="${nonce}">${refreshScript}</script></body></html>`;
}

export function statusBadge(status: "active" | "revoked" | "expired"): string {
  const label = status === "active" ? "Active" : status === "revoked" ? "Revoked" : "Expired";
  return `<span class="badge badge-${status}"><span class="dot"></span>${label}</span>`;
}
export function emptyState(title: string, note: string): string { return `<div class="empty"><div class="empty-title">${escapeHtml(title)}</div>${escapeHtml(note)}</div>`; }
export interface Column { label: string; num?: boolean; }
export function dataTable(cols: Column[], rows: string[][], rowClass?: (i:number)=>string|undefined): string {
  const head=cols.map(c=>`<th${c.num?' class="num"':''}>${escapeHtml(c.label)}</th>`).join("");
  const body=rows.map((cells,i)=>{ const cls=rowClass?.(i); const tds=cells.map((html,j)=>{const col=cols[j]!;return `<td data-label="${escapeHtml(col.label)}"${col.num?' class="num"':''}>${html}</td>`;}).join("");return `<tr${cls?` class="${cls}"`:""}>${tds}</tr>`;}).join("");
  return `<div class="table-wrap"><table class="responsive"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
