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

### 2026-08-29 — Claude — Agent naming write route locked down (fail-closed Basic Auth)
- Security fix ahead of merging PR #3: the Railway dashboard is public with no login, so the new `POST /agents/:account/:keyId/label` route was open to anyone with the URL. Guarded it with HTTP Basic Auth, scoped only to `/agents/*` — every read-only page (Overview/Activity/Keys) stays public and frictionless.
- Deliberately fails closed: if `ADMIN_USER`/`ADMIN_PASSWORD` aren't both set, the route returns 503 rather than silently staying open. Requires setting those two env vars on Railway before this protection takes effect.
- Not a full auth system by design: one shared credential pair, one route, no sessions/users — matches the single-operator MVP.
- Added tests for: wrong/missing credentials (401), and the route disabled entirely when unconfigured (503, and confirms no label is written).
- `npm test` and `npm run typecheck` pass.
- Handoff: pushed to the existing `claude/agent-identity-mvp` branch / PR #3, not yet merged. Founder action: set `ADMIN_USER` and `ADMIN_PASSWORD` on Railway before or immediately after merging.

### 2026-08-29 — Claude — Agent Identity MVP; total-spent discrepancy explained
- Shipped Agent Identity: human-readable labels for agent access keys. New local `agent_labels` table (Agent Spend's own data, never on-chain); `POST /agents/:account/:keyId/label` to set or clear a name; naming/renaming happens inline on the Overview page and the name now shows on Overview, Activity, and Keys, with the address kept visible as secondary text. Unnamed agents are unchanged.
- Investigated the reported 17.50 vs. 12.50+4.99 total-spent discrepancy: confirmed via raw on-chain logs that each payment transaction debits the access key's budget twice (the payment amount, plus a real flat ~0.005903 pathUSD per-transaction fee) — `spendTotals()` is correctly summing both, and the total matches the on-chain remaining budget exactly. No calculation changed. Documented in ENGINEERING.md.
- Extended `test/e2e.test.ts` with naming, renaming, clearing, and "unnamed agents unaffected" coverage; `npm test` and `npm run typecheck` pass.
- Deployed to Railway (Path A: unmodified persistent-process architecture, no serverless rearchitecture) — live and reachable in a browser.
- Handoff: changes are local/uncommitted pending founder review — not yet pushed or merged.

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
