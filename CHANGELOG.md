# Agent Spend — Changelog

This is the shared handoff log for the AI team. Add concise entries when meaningful product, engineering, or marketing changes happen.

## Current state

### Product
- Product direction established: spend management and financial controls for autonomous AI agents.
- Tempo is the policy/enforcement layer; Agent Spend is the management/control layer.

### Engineering
- Initial MVP dashboard and Tempo event indexer built.
- Local devnet fixture and automated tests built.
- Architecture documentation merged to main.
- Live Tempo testnet validation is the next milestone.

### Marketing
- Grok assigned as X marketing manager.
- ComfyUI assigned as visual production engine.
- Initial positioning: “Spend management for AI agents.”

### 2026-08-28 — Claude — Live Moderato validation succeeded end-to-end
- Ran the full milestone live on Moderato from a local machine (the prior remote environment was network-blocked): faucet-funded a fresh testnet-only account, authorized a scoped agent access key (500 pathUSD / 30 days), and made two real memo-tagged payments (tx `0xd51fc556…`, `0x2d4475a9…`).
- Dashboard, pointed at the same account and RPC, indexed both automatically and displayed the agent, amounts, recipients, memo commitments, transactions, and live remaining budget (482.50 pathUSD) — matching the on-chain read exactly.
- Fixed two bugs surfaced during the run: an invalid checksummed placeholder recipient address, and non-idempotent access-key authorization on re-run. Both in `scripts/live-agent.ts`.
- Why it matters: this is the product's core MVP thesis (real agent, real payment, automatic indexing, correct dashboard) proven against the real network, not a fixture.
- Handoff: branch `claude/agent-spend-eng-lead-adz5yr` has the fixes and doc updates, not yet merged to main — pending founder review.

### 2026-08-28 — Claude — Live Moderato validation prepared; budget reads now surface RPC failures
- Added `npm run live-agent`: real end-to-end flow on Tempo Moderato (official faucet funding, access-key authorization with a 500 pathUSD / 30-day limit, memo-tagged payments signed by the access key). Testnet-only keys are generated into gitignored `.local/`.
- Dashboard no longer shows a missing budget when the RPC is unreachable; it shows an explicit "unavailable" error state (contract-level "no limit" is still distinguished).
- Handoff: execution of the live run is blocked on the dev environment's network egress policy denying `rpc.moderato.tempo.xyz`. Founder action: allow that domain for the Claude Code environment, or run `npm run live-agent` + the dashboard locally.

## Update format
Add new entries at the top using:

### YYYY-MM-DD — Owner — Short title
- What changed
- Why it matters
- Any handoff / next action
