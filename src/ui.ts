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
  color-scheme: light;
  --bg: #f7f7f6;
  --surface: #ffffff;
  --border: #e8e7e4;
  --border-strong: #d9d8d4;
  --text: #171715;
  --text-secondary: #5c5b57;
  --text-muted: #8a8983;
  --accent: #171715;
  --accent-hover: #333331;
  --on-accent: #ffffff;
  --row-hover: #fbfbfa;
  --good: #0ca30c;
  --good-bg: #eef8ee;
  --good-text: #086308;
  --good-border: #cfe9cf;
  --critical: #d03b3b;
  --critical-bg: #fbf0f0;
  --critical-text: #9c2626;
  --critical-border: #f0d2d2;
  --danger-border: #e7b9b9;
  --neutral-bg: #f0efec;
  --warn: #d98a00;
  --warn-bg: #fdf4e3;
  --warn-text: #8a5300;
  --warn-border: #f1dcb4;
  --on-warn: #ffffff;
  --radius: 10px;
  --font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
}
/* Dark theme: follows the system unless the viewer picked Light; or forced via the toggle. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
  color-scheme: dark;
  --bg: #0f0f0e;
  --surface: #181817;
  --border: #2a2a28;
  --border-strong: #3b3b38;
  --text: #ecebe8;
  --text-secondary: #b3b2ad;
  --text-muted: #8a8984;
  --accent: #ecebe8;
  --accent-hover: #d4d3cf;
  --on-accent: #171715;
  --row-hover: #1f1f1d;
  --good: #3fcf3f;
  --good-bg: #15291a;
  --good-text: #86e086;
  --good-border: #24482c;
  --critical: #ef6b6b;
  --critical-bg: #2f1718;
  --critical-text: #f5a8a8;
  --critical-border: #4f2527;
  --danger-border: #5c2c2e;
  --neutral-bg: #252523;
  --warn: #f0a531;
  --warn-bg: #2f2512;
  --warn-text: #f5c77c;
  --warn-border: #4f3b16;
  --on-warn: #1c1402;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0f0f0e;
  --surface: #181817;
  --border: #2a2a28;
  --border-strong: #3b3b38;
  --text: #ecebe8;
  --text-secondary: #b3b2ad;
  --text-muted: #8a8984;
  --accent: #ecebe8;
  --accent-hover: #d4d3cf;
  --on-accent: #171715;
  --row-hover: #1f1f1d;
  --good: #3fcf3f;
  --good-bg: #15291a;
  --good-text: #86e086;
  --good-border: #24482c;
  --critical: #ef6b6b;
  --critical-bg: #2f1718;
  --critical-text: #f5a8a8;
  --critical-border: #4f2527;
  --danger-border: #5c2c2e;
  --neutral-bg: #252523;
  --warn: #f0a531;
  --warn-bg: #2f2512;
  --warn-text: #f5c77c;
  --warn-border: #4f3b16;
  --on-warn: #1c1402;
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
  color: var(--on-accent);
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
.theme-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 9px; font-size: 12px; font-weight: 550;
  color: var(--text-secondary); white-space: nowrap; flex-shrink: 0;
}
.footer {
  display: none;
  max-width: 1240px; margin: -40px auto 0; padding: 0 14px 28px;
  align-items: center; justify-content: space-between; gap: 12px;
  font-size: 12px; color: var(--text-muted);
}
.footer .net { display: inline-flex; margin-left: 0; }
.theme-toggle svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
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
tbody tr:hover { background: var(--row-hover); }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }

.amount { font-weight: 600; font-variant-numeric: tabular-nums; }
.amount .sym { font-weight: 450; color: var(--text-muted); font-size: 12px; margin-left: 3px; }
.mono { font-family: var(--mono); font-size: 12.5px; }
.muted { color: var(--text-muted); }
.budget-error { color: var(--critical); }
.secondary { color: var(--text-secondary); }
.sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

.agent-name { font-weight: 620; }
.label-form { display: flex; gap: 6px; margin-top: 8px; margin-bottom: 4px; }
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
.badge-active { background: var(--good-bg); color: var(--good-text); }
.badge-active .dot { background: var(--good); }
.badge-revoked { background: var(--critical-bg); color: var(--critical-text); }
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
.grid-2 + .card, .card + .grid-2, .grid-2 + .grid-2, .stats + .grid-2 { margin-top: 20px; }
.stats + .card { margin-top: 0; }
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

.nav-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px; margin-left: 6px;
  border-radius: 999px; background: var(--warn); color: var(--on-warn);
  font-size: 11px; font-weight: 650;
}
.stats-4 { grid-template-columns: repeat(4, 1fr); }
.stat a { color: inherit; }
.title-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.page-title .mono { font-size: inherit; }
.agent-link { text-decoration: none; }
.agent-link:hover .agent-name, a.agent-link:hover > .mono { text-decoration: underline; text-underline-offset: 2px; }

.flash { border-radius: var(--radius); padding: 10px 14px; margin-bottom: 18px; font-weight: 520; border: 1px solid; }
.flash-good { background: var(--good-bg); color: var(--good-text); border-color: var(--good-border); }
.flash-bad { background: var(--critical-bg); color: var(--critical-text); border-color: var(--critical-border); }

.attention { border-color: var(--warn-border); }
.attention .card-head { background: var(--warn-bg); }
.attention-list { list-style: none; }
.attention-list li { display: flex; align-items: center; gap: 10px; padding: 10px 18px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.attention-list li:last-child { border-bottom: none; }
.dot-low, .dot-exhausted, .dot-ok { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dot-low { background: var(--warn); }
.dot-exhausted { background: var(--critical); }
.dot-ok { background: var(--good); }

.budget { display: inline-grid; justify-items: end; gap: 3px; }
.bar { width: 120px; height: 6px; display: block; }
.stat .bar { width: 100%; margin-top: 8px; }
.bar-track { fill: var(--neutral-bg); }
.bar-ok .bar-fill { fill: var(--good); }
.bar-low .bar-fill { fill: var(--warn); }
.bar-exhausted .bar-fill { fill: var(--critical); }
.pct { font-size: 11px; font-weight: 600; padding: 0 5px; border-radius: 4px; }
.pct-ok { color: var(--good-text); background: var(--good-bg); }
.pct-low { color: var(--warn-text); background: var(--warn-bg); }
.pct-exhausted { color: var(--critical-text); background: var(--critical-bg); }

.chart { width: 100%; height: 120px; display: block; }
.chart-bar { fill: var(--accent); opacity: 0.85; }
.chart-bar:hover { opacity: 1; }
.chart-base { stroke: var(--border-strong); stroke-width: 1; }
.chart-axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); margin-top: 6px; }
.empty.compact { padding: 24px 12px; }

.clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: normal; max-width: 340px; }
.hint { font-size: 12px; color: var(--text-muted); margin-top: 6px; }
.stack-form + .stack-form { margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--border); }
.stack-form label, .grid-form label { display: grid; gap: 6px; font-size: 12px; font-weight: 550; color: var(--text-secondary); }
.field-row { display: flex; gap: 6px; flex-wrap: wrap; }
input[type="text"], input[type="number"], select {
  font: inherit; font-size: 13px; padding: 6px 9px;
  border: 1px solid var(--border-strong); border-radius: 6px;
  background: var(--surface); color: var(--text); min-width: 0;
}
input:focus-visible, select:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.stack-form input[type="text"] { width: 150px; }
button {
  font: inherit; font-size: 13px; font-weight: 560; padding: 6px 12px;
  border: 1px solid var(--border-strong); border-radius: 6px;
  background: var(--surface); color: var(--text); cursor: pointer;
}
button:hover { background: var(--neutral-bg); }
button.primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
button.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
button.danger { color: var(--critical); border-color: var(--danger-border); }
button.danger:hover { background: var(--critical-bg); }
.grid-form { display: grid; grid-template-columns: 2fr 1fr; gap: 14px 18px; }
.grid-form label:first-child { grid-column: 1 / -1; }
.grid-form input[type="text"], .grid-form input[type="number"], .grid-form select { width: 100%; }
.grid-form .field-row input { flex: 1; }
.grid-form .field-row select { width: auto; }
.form-actions { grid-column: 1 / -1; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.form-actions .hint { margin-top: 0; flex: 1; min-width: 220px; }

.requests { display: grid; }
.request { padding: 16px 18px; border-bottom: 1px solid var(--border); display: grid; gap: 10px; }
.request:last-child { border-bottom: none; }
.request-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.request-amount .amount { font-size: 18px; }
.request-actions { display: flex; gap: 10px 20px; flex-wrap: wrap; align-items: flex-end; }
.inline-form { display: flex; gap: 6px; align-items: flex-end; flex-wrap: wrap; }
.inline-form label { display: grid; gap: 4px; font-size: 12px; color: var(--text-secondary); font-weight: 550; }
.inline-form input[type="text"] { width: 150px; }
.inline-form input[name="note"] { width: 240px; }
.facts.compact { gap: 4px 14px; font-size: 13px; }
.badge-pending { background: var(--warn-bg); color: var(--warn-text); }
.badge-pending .dot { background: var(--warn); }

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
  .topbar .theme-toggle { display: none; }
  .footer { display: flex; }
  .nav a { padding: 0 9px; }
  .net { display: none; }
  .page { padding: 20px 14px 48px; }
  .stats, .stats-4 { grid-template-columns: 1fr 1fr; }
  .stat-value { font-size: 20px; }
  .grid-form { grid-template-columns: 1fr; }
  .request-actions, .inline-form { width: 100%; }
  .inline-form input[type="text"], .inline-form input[name="note"] { flex: 1; width: auto; }
  .bar { width: 100px; }
  .clamp { max-width: 100%; }
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
// (a reload would discard what they entered). Forms with data-confirm ask
// before submitting (revoke, approve).
const refreshScript = /* js */ `
document.addEventListener("submit", function (e) {
  var msg = e.target.getAttribute && e.target.getAttribute("data-confirm");
  if (msg && !window.confirm(msg)) e.preventDefault();
});
if (location.search.indexOf("flash=") !== -1) {
  history.replaceState(null, "", location.pathname);
}
var dirty = false;
document.addEventListener("input", function () { dirty = true; });
setInterval(function () {
  var a = document.activeElement;
  var editing = a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT");
  if (!document.hidden && !editing && !dirty) location.reload();
}, 10000);
`;

// Runs in <head> before first paint so a stored Light/Dark choice never flashes.
const themeInitScript = /* js */ `
(function () {
  var t = null;
  try { t = localStorage.getItem("theme"); } catch (e) {}
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
})();
`;

// Header toggle: Auto (system) → Light → Dark → Auto. The choice is a
// per-viewer convenience kept in localStorage; Auto removes it.
const themeToggleScript = /* js */ `
(function () {
  var btns = document.querySelectorAll(".theme-toggle");
  if (!btns.length) return;
  var order = ["auto", "light", "dark"];
  var names = { auto: "Auto", light: "Light", dark: "Dark" };
  var icons = {
    auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
  };
  function current() {
    var t = document.documentElement.getAttribute("data-theme");
    return t === "light" || t === "dark" ? t : "auto";
  }
  function effectiveDark(t) {
    return t === "dark" || (t === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
  function render(t) {
    btns.forEach(function (btn) {
      btn.innerHTML = icons[t] + '<span class="theme-label">' + names[t] + "</span>";
      btn.setAttribute("aria-label", "Theme: " + names[t] + ". Change theme");
      btn.title = "Theme: " + names[t];
    });
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", effectiveDark(t) ? "#181817" : "#ffffff");
  }
  function cycle() {
    var next = order[(order.indexOf(current()) + 1) % order.length];
    if (next === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
    try {
      if (next === "auto") localStorage.removeItem("theme");
      else localStorage.setItem("theme", next);
    } catch (e) {}
    render(next);
  }
  btns.forEach(function (btn) { btn.addEventListener("click", cycle); });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { render(current()); });
  render(current());
})();
`;

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#171715"/><text x="16" y="22" font-family="system-ui,sans-serif" font-size="16" font-weight="700" fill="#fff" text-anchor="middle">A</text></svg>`,
  );

export interface NavContext {
  active: "overview" | "activity" | "approvals" | "keys";
  network: string;
  /** Shown as a count badge on the Approvals tab. */
  pendingApprovals?: number;
}

export function layout(title: string, nav: NavContext, body: string, nonce: string): string {
  const tabs = [
    { href: "/", id: "overview", label: "Overview" },
    { href: "/activity", id: "activity", label: "Activity" },
    { href: "/approvals", id: "approvals", label: "Approvals" },
    { href: "/keys", id: "keys", label: "Keys" },
  ];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#ffffff">
<link rel="icon" href="${FAVICON}">
<script nonce="${nonce}">${themeInitScript}</script>
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
            `<a href="${t.href}"${t.id === nav.active ? ' class="active" aria-current="page"' : ""}>${t.label}${
              t.id === "approvals" && nav.pendingApprovals
                ? ` <span class="nav-count" aria-label="${nav.pendingApprovals} pending">${nav.pendingApprovals}</span>`
                : ""
            }</a>`,
        )
        .join("")}
    </nav>
    <span class="net"><span class="net-dot"></span>${escapeHtml(nav.network)}</span>
    <button type="button" class="theme-toggle" aria-label="Change theme">Theme</button>
  </div>
</header>
<main class="page">
${body}
</main>
<footer class="footer">
  <span class="net"><span class="net-dot"></span>${escapeHtml(nav.network)}</span>
  <button type="button" class="theme-toggle" aria-label="Change theme">Theme</button>
</footer>
<script nonce="${nonce}">${themeToggleScript}${refreshScript}</script>
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
