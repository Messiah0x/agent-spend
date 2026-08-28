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
