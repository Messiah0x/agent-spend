import { escapeHtml } from "./ui.js";

export interface OnboardingState {
  agentCount: number;
  paymentCount: number;
  pendingApprovals: number;
  network: string;
}

/**
 * First-run guidance for operators. This stays deliberately server-rendered so
 * the product remains useful without a client framework or local-storage state.
 */
export function onboardingPanel(state: OnboardingState): string {
  const firstRun = state.agentCount === 0 && state.paymentCount === 0;
  if (!firstRun) return "";

  return `<section class="card onboarding" aria-labelledby="onboarding-title">
    <div class="onboarding-copy">
      <span class="eyebrow">Getting started</span>
      <h2 id="onboarding-title">Controlled spending for autonomous AI agents</h2>
      <p>Give agents the ability to pay on ${escapeHtml(state.network)} without giving them unrestricted wallet access. Spending rules are enforced on-chain, while Agent Spend gives operators visibility and approval controls.</p>
    </div>
    <ol class="onboarding-steps">
      <li><span class="step-num">1</span><div><strong>Connect a Tempo account</strong><span>Watch the account that will provision agent access keys.</span></div></li>
      <li><span class="step-num">2</span><div><strong>Provision an agent key</strong><span>Set its budget and spending rules on-chain.</span></div></li>
      <li><span class="step-num">3</span><div><strong>Let the agent transact</strong><span>Payments inside those limits can execute autonomously.</span></div></li>
      <li><span class="step-num">4</span><div><strong>Monitor and approve</strong><span>Review spend, signed reasons, recipients, and budget requests here.</span></div></li>
    </ol>
    <div class="onboarding-actions">
      <a class="button primary-link" href="/keys">View agent keys</a>
      <a class="button secondary-link" href="/help">How Agent Spend works</a>
    </div>
  </section>`;
}

export function instructionalEmptyState(kind: "agents" | "activity" | "approvals" | "keys"): { title: string; note: string } {
  switch (kind) {
    case "agents":
      return {
        title: "No agents connected yet",
        note: "Provision a Tempo access key for an agent. Once the watched account authorizes it, the agent and its live on-chain budget will appear here automatically.",
      };
    case "activity":
      return {
        title: "No agent payments yet",
        note: "Transactions will appear here as agents begin spending. Agent Spend reconstructs payment activity from Tempo and can attach signed payment reasons when agents provide them.",
      };
    case "approvals":
      return {
        title: "No budget requests waiting",
        note: "When an agent needs more budget, its signed request will appear here for operator review before any increase is approved on-chain.",
      };
    case "keys":
      return {
        title: "No access keys indexed yet",
        note: "Agent access keys authorized by watched Tempo accounts appear here automatically. Each key can have its own budget, lifecycle, and spending controls.",
      };
  }
}
