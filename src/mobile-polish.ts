// Mobile presentation layer for the server-rendered dashboard.
export const mobilePolishCss = String.raw`
@media (max-width: 720px) {
  :root { --mobile-nav-h: 54px; }
  html, body { min-height: 100%; }
  body {
    background:
      radial-gradient(520px 280px at 85% -5%, rgba(88,166,255,.10), transparent 58%),
      linear-gradient(180deg,#222930 0%,#20272e 100%);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .page {
    padding: 16px 14px max(82px,calc(var(--mobile-nav-h) + 24px + env(safe-area-inset-bottom)));
  }
  .page::before {
    content: "AGENT SPEND  •  TEMPO";
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 0 9px;
    margin: 0 0 14px;
    border: 1px solid rgba(88,166,255,.20);
    border-radius: 999px;
    background: rgba(88,166,255,.07);
    color: #9fc9ff;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: .13em;
  }
  .page-title { font-size: 27px; line-height: 1.05; letter-spacing: -.04em; }
  .page-sub {
    max-width: 31rem;
    margin-top: 7px;
    margin-bottom: 18px;
    font-size: 13px;
    line-height: 1.45;
    color: #aeb8c2;
  }

  .stats,.stats-4 {
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:9px;
    margin-bottom:16px;
  }
  .stat {
    position:relative;
    min-height:92px;
    padding:13px 13px 12px;
    overflow:hidden;
    border-radius:14px;
    border-color:#3d4853;
    background:linear-gradient(145deg,#2d353e,#29313a);
    box-shadow:0 8px 22px rgba(0,0,0,.10),inset 0 1px rgba(255,255,255,.02);
  }
  .stat::after {
    content:"";
    position:absolute;
    right:-24px;
    bottom:-34px;
    width:76px;
    height:76px;
    border-radius:50%;
    background:rgba(88,166,255,.055);
  }
  .stat-label { font-size:10.5px; line-height:1.25; color:#b9c2cc; }
  .stat-value { margin-top:8px; font-size:23px; line-height:1.05; letter-spacing:-.025em; }
  .stat-value .unit { font-size:11px; margin-left:3px; color:#929da8; }

  .card {
    border-radius:15px;
    border-color:#3d4853;
    background:linear-gradient(180deg,#2b333c 0%,#29313a 100%);
    box-shadow:0 12px 28px rgba(0,0,0,.10);
    overflow:hidden;
  }
  .card + .card { margin-top:13px; }
  .card-head {
    padding:13px 14px;
    align-items:center;
    gap:8px;
    background:rgba(255,255,255,.012);
  }
  .card-title { font-size:14px; flex:0 0 auto; }
  .card-note { max-width:62%; font-size:9.5px; line-height:1.3; text-align:right; color:#8f9ba7; }

  .empty {
    position:relative;
    padding:29px 18px 28px;
    font-size:12.5px;
    line-height:1.5;
  }
  .empty::before {
    content:"+";
    display:grid;
    place-items:center;
    width:38px;
    height:38px;
    margin:0 auto 12px;
    border:1px solid rgba(88,166,255,.35);
    border-radius:12px;
    background:rgba(88,166,255,.09);
    color:#69afff;
    font-size:23px;
    font-weight:400;
  }
  .empty-title { font-size:15px; color:#e1e6eb; margin-bottom:6px; }
  .empty-actions {
    display:grid;
    grid-template-columns:1.35fr 1fr;
    gap:9px;
    width:min(100%,350px);
    margin:17px auto 0;
  }
  .empty-actions a {
    min-width:0;
    min-height:40px;
    display:flex;
    align-items:center;
    justify-content:center;
    padding:8px 11px;
    border:1px solid #4a5865;
    border-radius:10px;
    color:#d7dde3;
    font-size:11px;
    line-height:1.2;
    font-weight:700;
    text-decoration:none;
    text-align:center;
    background:#333d47;
  }
  .empty-actions a.primary-link {
    border-color:#58a6ff;
    background:linear-gradient(180deg,#65afff,#509cf0);
    color:#102031;
    box-shadow:0 7px 18px rgba(88,166,255,.18);
  }

  .topbar {
    left:14px;
    right:14px;
    bottom:calc(8px + env(safe-area-inset-bottom));
    width:auto;
    height:var(--mobile-nav-h);
    border:1px solid #3d4853;
    border-radius:18px;
    background:rgba(27,33,40,.96);
    box-shadow:0 14px 36px rgba(0,0,0,.32);
    overflow:hidden;
    backdrop-filter:blur(16px);
    -webkit-backdrop-filter:blur(16px);
  }
  .topbar-inner { height:100%; padding:4px 6px; }
  .nav { height:100%; align-items:center; justify-content:space-around; }
  .nav a { width:min(72px,23vw); height:44px; gap:1px; border-radius:12px; }
  .nav a.active { background:rgba(88,166,255,.12)!important; }
  .nav a.active::before { top:-4px; width:22px; height:2px; box-shadow:0 0 10px rgba(88,166,255,.45); }
  .nav-icon { width:18px; height:18px; font-size:15px; line-height:1; }
  .nav-label { font-size:8.5px; line-height:1.1; font-weight:700; }
  .nav-count { top:0; right:1px; }
}

@media (max-width:390px) {
  .page { padding-left:12px; padding-right:12px; }
  .stats,.stats-4 { gap:7px; }
  .stat { min-height:86px; padding:12px; }
  .card-note { max-width:56%; }
  .empty-actions { grid-template-columns:1fr; max-width:245px; }
}
`;