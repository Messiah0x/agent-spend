// Mobile presentation layer for the server-rendered dashboard.
export const mobilePolishCss = String.raw`
@media (max-width: 720px) {
  :root { --mobile-nav-h: 52px; }
  html, body { min-height: 100%; }
  body { background: #242a31; padding-bottom: env(safe-area-inset-bottom); }

  .page {
    padding: 16px 14px calc(var(--mobile-nav-h) + 20px + env(safe-area-inset-bottom));
  }
  .page::before {
    content: "Agent Spend";
    display: block;
    margin: 0 0 12px;
    color: #8f9aa6;
    font-size: 10px;
    font-weight: 750;
    letter-spacing: .12em;
    text-transform: uppercase;
  }
  .page-title { font-size: 24px; line-height: 1.1; letter-spacing: -.035em; }
  .page-sub {
    max-width: 31rem;
    margin-top: 5px;
    margin-bottom: 16px;
    font-size: 13px;
    line-height: 1.42;
    color: #aeb8c2;
  }

  .stats, .stats-4 {
    grid-template-columns: repeat(2,minmax(0,1fr));
    gap: 8px;
    margin-bottom: 14px;
  }
  .stat {
    min-height: 78px;
    padding: 11px 12px;
    border-radius: 12px;
    box-shadow: none;
  }
  .stat-label { font-size: 10.5px; line-height: 1.25; }
  .stat-value { margin-top: 5px; font-size: 20px; line-height: 1.05; }
  .stat-value .unit { font-size: 11px; margin-left: 3px; }

  .card { border-radius: 12px; box-shadow: 0 6px 18px rgba(0,0,0,.05); }
  .card + .card { margin-top: 12px; }
  .card-head {
    padding: 11px 12px;
    align-items: flex-start;
    gap: 8px;
  }
  .card-title { font-size: 13px; flex: 0 0 auto; }
  .card-note {
    max-width: 62%;
    font-size: 9.5px;
    line-height: 1.3;
    text-align: right;
  }

  .empty {
    padding: 24px 16px 26px;
    font-size: 12.5px;
    line-height: 1.45;
  }
  .empty-title { font-size: 14px; color: #d7dde3; margin-bottom: 5px; }
  .empty-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    width: min(100%, 330px);
    margin: 14px auto 0;
  }
  .empty-actions a {
    min-width: 0;
    min-height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 7px 10px;
    border: 1px solid #4a5663;
    border-radius: 9px;
    color: #d7dde3;
    font-size: 11px;
    line-height: 1.2;
    font-weight: 650;
    text-decoration: none;
    text-align: center;
    background: #313943;
  }
  .empty-actions a.primary-link {
    border-color: #58a6ff;
    background: #58a6ff;
    color: #102031;
  }

  .topbar {
    left: 10px;
    right: 10px;
    bottom: calc(6px + env(safe-area-inset-bottom));
    width: auto;
    height: var(--mobile-nav-h);
    border: 1px solid #3a434d;
    border-radius: 15px;
    background: rgba(29,35,42,.97);
    box-shadow: 0 10px 28px rgba(0,0,0,.26);
    overflow: hidden;
  }
  .topbar-inner { height: 100%; padding: 3px 6px; }
  .nav { height: 100%; align-items: center; }
  .nav a {
    width: min(68px,23vw);
    height: 42px;
    gap: 0;
    border-radius: 10px;
  }
  .nav a.active { background: rgba(88,166,255,.10) !important; }
  .nav a.active::before { top: -3px; width: 18px; height: 2px; }
  .nav-icon { width: 18px; height: 17px; font-size: 15px; line-height: 1; }
  .nav-label { font-size: 8.5px; line-height: 1.1; font-weight: 650; }
  .nav-count { top: 0; right: 1px; }

  @supports (padding: max(0px)) {
    .page { padding-bottom: max(76px, calc(var(--mobile-nav-h) + 20px + env(safe-area-inset-bottom))); }
  }
}

@media (max-width: 390px) {
  .page { padding-left: 12px; padding-right: 12px; }
  .stats, .stats-4 { gap: 7px; }
  .stat { min-height: 74px; padding: 10px 11px; }
  .card-note { max-width: 58%; }
  .empty-actions { grid-template-columns: 1fr; max-width: 230px; }
}
`;