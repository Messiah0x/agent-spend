import { escapeHtml } from "./ui.js";

export function gettingStartedPage(network: string): string {
  return `<div class="guide-hero">
    <span class="eyebrow">GETTING STARTED · ${escapeHtml(network)}</span>
    <h1 class="page-title">How Agent Spend works</h1>
    <p class="page-sub">A guided map from giving an AI agent a controlled budget to understanding its payments, approving more budget, and revoking access when needed.</p>
    <div class="guide-actions"><a class="guide-button primary-link" href="/keys">Set up your first agent</a><a class="guide-button" href="/">Open dashboard</a></div>
  </div>
  <section class="guide-flow" aria-label="Agent Spend workflow">
    <article class="guide-step"><span class="guide-num">01</span><div class="guide-icon">▣</div><h2>Create an agent key</h2><p>Start in <strong>Keys</strong>. Authorize a dedicated Tempo access key and give the agent a spending limit. The agent never needs your root wallet key.</p><a href="/keys">Go to Keys →</a></article>
    <article class="guide-step"><span class="guide-num">02</span><div class="guide-icon">$</div><h2>The agent spends</h2><p>The agent makes payments inside its on-chain policy. Agent Spend watches Tempo and attributes activity to the correct access key automatically.</p><a href="/activity">See Activity →</a></article>
    <article class="guide-step"><span class="guide-num">03</span><div class="guide-icon">≡</div><h2>Understand every payment</h2><p><strong>Activity</strong> shows the amount, recipient, transaction and, when supplied by the agent, a signed reason explaining why the payment happened.</p><a href="/activity">Explore Activity →</a></article>
    <article class="guide-step"><span class="guide-num">04</span><div class="guide-icon">✓</div><h2>Approve more budget</h2><p>If an agent reaches its limit, it can request more. <strong>Approvals</strong> lets you review the request before its spending limit changes on-chain.</p><a href="/approvals">Open Approvals →</a></article>
    <article class="guide-step"><span class="guide-num">05</span><div class="guide-icon">⌂</div><h2>Monitor from Overview</h2><p><strong>Overview</strong> is the control center for active agents, total spend, live budgets, pending requests and anything requiring attention.</p><a href="/">View Overview →</a></article>
    <article class="guide-step"><span class="guide-num">06</span><div class="guide-icon">×</div><h2>Stay in control</h2><p>Open an agent to change its limit or revoke its key. Tempo enforces the boundary on-chain rather than relying on the agent to behave correctly.</p><a href="/keys">Manage Keys →</a></article>
  </section>
  <section class="card guide-map"><div class="card-head"><span class="card-title">What each screen is for</span><span class="card-note">quick reference</span></div><div class="guide-map-grid">
    <a href="/"><strong>Overview</strong><span>Fleet health, budgets and alerts</span></a><a href="/activity"><strong>Activity</strong><span>Payments, recipients and reasons</span></a><a href="/approvals"><strong>Approvals</strong><span>Human review for budget increases</span></a><a href="/keys"><strong>Keys</strong><span>Agent access and lifecycle controls</span></a>
  </div></section>
  <section class="guide-callout"><div><span class="eyebrow">THE CORE IDEA</span><h2>Humans set the boundaries. Agents operate inside them.</h2><p>Agent Spend is the visibility and management layer. Tempo AccountKeychain is the enforcement layer.</p></div><a class="guide-button primary-link" href="/keys">Get started</a></section>`;
}
