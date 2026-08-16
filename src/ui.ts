// Server-rendered UI. No client framework; one shared stylesheet, three pages.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  max-width: 1080px;
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
.nav { display: flex; gap: 4px; height: 100%; }
.nav a {
  display: inline-flex;
  align-items: center;
  padding: 0 12px;
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

.page { max-width: 1080px; margin: 0 auto; padding: 28px 20px 64px; }
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
  padding: 10px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
td {
  padding: 12px 18px;
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
.secondary { color: var(--text-secondary); }
.sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

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

.chip {
  display: inline-block;
  background: var(--neutral-bg);
  border-radius: 6px;
  padding: 1px 7px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-secondary);
}

.empty {
  padding: 48px 20px;
  text-align: center;
  color: var(--text-muted);
}
.empty-title { font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; }

.txlink { color: var(--text-secondary); text-decoration: none; border-bottom: 1px dotted var(--border-strong); }
.txlink:hover { color: var(--text); border-bottom-color: var(--text-muted); }

@media (max-width: 720px) {
  .topbar-inner { gap: 14px; padding: 0 14px; }
  .net { display: none; }
  .page { padding: 20px 14px 48px; }
  .stats { grid-template-columns: 1fr; }
  th, td { padding-left: 14px; padding-right: 14px; }
}
`;

const refreshScript = /* js */ `
setInterval(function () {
  if (!document.hidden) location.reload();
}, 10000);
`;

export interface NavContext {
  active: "overview" | "activity" | "keys";
  network: string;
}

export function layout(title: string, nav: NavContext, body: string): string {
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
<title>${escapeHtml(title)} · Agent Spend</title>
<style>${css}</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <a class="brand" href="/"><span class="brand-mark">A</span>Agent Spend</a>
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
<script>${refreshScript}</script>
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
