// Final mobile presentation layer. Kept separate from the shared server-rendered
// stylesheet so the mobile shell can evolve without disturbing desktop tables/forms.
export const mobilePolishCss = String.raw`
@media (max-width: 720px) {
  :root { --mobile-nav-h: 58px; }
  body { background: #242a31; padding-bottom: env(safe-area-inset-bottom); }

  /* Give the mobile app a quiet product identity without adding another toolbar. */
  .page::before {
    content: "Agent Spend";
    display: block;
    margin: 0 0 18px;
    color: #8f9aa6;
    font-size: 11px;
    font-weight: 750;
    letter-spacing: .12em;
    text-transform: uppercase;
  }

  .page {
    padding: 20px 16px calc(var(--mobile-nav-h) + 26px + env(safe-area-inset-bottom));
  }
  .page-title { font-size: 26px; line-height: 1.15; letter-spacing: -.035em; }
  .page-sub {
    max-width: 34rem;
    margin-top: 7px;
    margin-bottom: 20px;
    font-size: 14px;
    line-height: 1.5;
    color: #aeb8c2;
  }

  /* Dense, glanceable metrics: still two columns, but no oversized tiles. */
  .stats, .stats-4 { gap: 10px; margin-bottom: 18px; }
  .stat { min-height: 98px; padding: 14px 15px; border-radius: 14px; }
  .stat-label { font-size: 11px; line-height: 1.3; }
  .stat-value { margin-top: 7px; font-size: 22px; line-height: 1.1; }
  .stat-value .unit { font-size: 12px; }

  .card { border-radius: 14px; box-shadow: 0 8px 24px rgba(0,0,0,.06); }
  .card + .card { margin-top: 14px; }
  .card-head {
    padding: 13px 15px;
    align-items: flex-start;
    gap: 8px;
  }
  .card-title { font-size: 14px; }
  .card-note {
    max-width: 58%;
    font-size: 10.5px;
    line-height: 1.35;
    text-align: right;
  }

  /* Empty screens should guide the user instead of looking unfinished. */
  .empty { padding: 34px 18px; }
  .empty-title { font-size: 15px; color: #d7dde3; margin-bottom: 7px; }
  .empty-actions {
    display: flex;
    justify-content: center;
    gap: 9px;
    flex-wrap: wrap;
    margin-top: 17px;
  }
  .empty-actions a {
    min-height: 38px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 8px 13px;
    border: 1px solid #4a5663;
    border-radius: 9px;
    color: #d7dde3;
    font-size: 12px;
    font-weight: 650;
    text-decoration: none;
    background: #313943;
  }
  .empty-actions a.primary-link {
    border-color: #58a6ff;
    background: #58a6ff;
    color: #102031;
  }

  /* Compact native-app-style bottom dock. */
  .topbar {
    left: 12px;
    right: 12px;
    bottom: calc(8px + env(safe-area-inset-bottom));
    width: auto;
    height: var(--mobile-nav-h);
    border: 1px solid #3a434d;
    border-radius: 17px;
    background: rgba(32,38,45,.96);
    box-shadow: 0 12px 34px rgba(0,0,0,.28);
    overflow: hidden;
  }
  .topbar-inner { height: 100%; padding: 5px 8px; }
  .nav { height: 100%; }
  .nav a {
    width: min(70px, 23vw);
    height: 46px;
    gap: 1px;
    border-radius: 11px;
  }
  .nav a.active { background: rgba(88,166,255,.10) !important; }
  .nav a.active::before { top: -5px; width: 20px; }
  .nav-icon { height: 19px; font-size: 16px; }
  .nav-label { font-size: 9px; font-weight: 650; }

  /* Keep browser chrome from visually merging into the application dock. */
  @supports (padding: max(0px)) {
    .page { padding-bottom: max(92px, calc(var(--mobile-nav-h) + 26px + env(safe-area-inset-bottom))); }
  }
}

@media (max-width: 390px) {
  .page { padding-left: 13px; padding-right: 13px; }
  .stats, .stats-4 { gap: 8px; }
  .stat { padding: 13px; min-height: 92px; }
  .card-note { max-width: 54%; }
}
`;