import { escapeHtml } from "./ui.js";

export interface HelpPageOptions { network: string; }

/** Public, indexable product education for Agent Spend. */
export function helpContent({ network }: HelpPageOptions): string {
  const safeNetwork = escapeHtml(network);
  return `<div class="help-hero"><span class="eyebrow">Agent Spend guide</span><h1>AI agent payments with enforceable spending controls</h1><p>Agent Spend is a financial control plane for autonomous AI agents. Operators set budgets and permissions on Tempo, agents pay independently inside those rules, and teams retain a clear audit trail.</p></div>
  <div class="help-grid">
    <section class="card help-card"><h2>How it works</h2><p>Provision a Tempo access key for each agent, assign its on-chain budget and spending rules, then monitor payments and remaining budget from Agent Spend.</p></section>
    <section class="card help-card"><h2>On-chain spending limits</h2><p>Critical financial boundaries are enforced by ${safeNetwork}, rather than relying on an AI agent or application server to voluntarily respect a software-only limit.</p></section>
    <section class="card help-card"><h2>Agent payment approvals</h2><p>Agents can request additional budget when they reach a limit. Operators review the request and decide whether to approve an on-chain increase.</p></section>
    <section class="card help-card"><h2>Payment reasons and auditability</h2><p>Agents can attach signed reasons to payments so operators can understand what was purchased, why the payment happened, and which agent authorized it.</p></section>
    <section class="card help-card"><h2>Monitoring without lock-in</h2><p>Agent Spend watches Tempo accounts and reconstructs activity from on-chain state and events. Basic observability does not require every agent to use a proprietary tracking SDK.</p></section>
    <section class="card help-card"><h2>Revoking an agent</h2><p>When an agent should no longer spend, revoke its access key. The control boundary stays with the operator and the underlying payment infrastructure.</p></section>
  </div>
  <section class="card help-security"><span class="eyebrow">Security model</span><h2>Autonomy inside explicit financial boundaries</h2><p>Agent Spend is designed for AI agent wallets, autonomous agent payments, programmable payments, and agent spend management where humans define the limits and agents operate inside them.</p></section>`;
}

export const helpSeo = {
  title: "Agent Spend | AI Agent Payments & Spending Controls",
  description: "Control autonomous AI agent payments with on-chain budgets, Tempo access keys, payment approvals, signed reasons, and agent spend monitoring.",
};
