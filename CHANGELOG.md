# Agent Spend — Changelog

This is the shared handoff log for the AI team. Add concise entries when meaningful product, engineering, or marketing changes happen.

## Current state

### Product
- Product direction established: spend management and financial controls for autonomous AI agents.
- Tempo is the policy/enforcement layer; Agent Spend is the management/control layer.

### Engineering
- MVP dashboard + Tempo event indexer, validated live on Moderato (2026-08-28).
- Agent Identity merged to main, with fail-closed Basic Auth on the write route.
- Hackathon-ready MVP (2026-09-30): hardening, reasons ledger + SDK + MCP, on-chain key controls, approvals, alerts, agent pages — see entries below. 71 tests, CI on every PR.

### Marketing
- Grok assigned as X marketing manager.
- ComfyUI assigned as visual production engine.
- Initial positioning: “Spend management for AI agents.”

### 2026-09-30 — Claude — Control plane: on-chain key controls, approvals, alerts, agent pages
- Key controls from the dashboard — authorize a new agent (native Tempo spending limit, period, expiry), set a limit, revoke (kill switch). Each is a real AccountKeychain transaction submitted by an optional operator key (`OPERATOR_MODE=admin` uses an admin access key, so the root key never lives on the server). Every action is in an operator audit log.
- Approvals: an agent that hits its limit sends a signed budget request (SDK `requestApproval`, MCP `request_approval`); the owner is notified by webhook, reviews it on the new **Approvals** page, and approving raises the limit on-chain. Double-submits can't execute twice; expired (7d) requests can't be approved; denials carry a note back to the agent.
- Agent pages: budget bar, burn rate, runway, 30-day spend chart, top recipients, controls, requests, key history, operator actions.
- Alerts: "Needs attention" on the Overview (low/exhausted budgets, pending requests); webhook alerts once per budget period (`ALERT_THRESHOLD_PCT`, `WEBHOOK_URL`).
- Demo: `npm run demo:stack` + `npm run demo` runs the whole story in two terminals; `npm run new-agent-key`; `.env.example`; GitHub Actions CI.
- Security: all new writes behind fail-closed Basic Auth + CSRF + rate limits; strict amount/address validation; no open redirects; fixed-string flash messages; Slack-escaped webhook text; RPC URLs stripped from surfaced errors.
- Verified in a real browser (Playwright): approve flow incl. confirm dialog, no CSP violations, desktop + mobile layouts.
- New `test/controls.test.ts`; 71 tests pass, typecheck clean.
- Handoff: PR `claude/controls-approvals` (stacked on `claude/reasons-ledger`). To enable controls on Railway: authorize an admin access key for the account, then set `OPERATOR_MODE=admin`, `OPERATOR_PRIVATE_KEY`, plus `TRUST_PROXY=1`, `PUBLIC_URL`, optionally `WEBHOOK_URL`.

### 2026-09-30 — Claude — Reasons ledger, Agent SDK, MCP server, JSON API
- Every payment can now carry a signed reason: the agent hashes a reason record (payer, key, token, recipient, amount, reason, optional MPP context, nonce), signs it with its access key, registers it, and pays with the hash as the memo. Activity shows the reason with a **Verified** badge (chain payment matches the record) or **Mismatch**; `/payments/:tx` shows the full proof.
- Agent API authenticates by access-key signature — no shared secrets; only keys the account authorized on-chain (and hasn't revoked) can write.
- Agent SDK (`createAgent().pay(...)`) with a live-budget pre-check, and an MCP server (`npm run mcp`) exposing `get_budget`/`pay` to any MCP agent.
- Activity folds each per-tx fee into its payment row (`+ 0.005903 fee`) instead of a separate row; fees show real precision instead of `0.00`.
- `npm run demo` now pays through the SDK; `live-agent` does too when `AGENT_SPEND_URL` is set.
- New `test/reasons.test.ts`; 46 tests pass, typecheck clean.
- Handoff: PR `claude/reasons-ledger` (stacked on `claude/hackathon-hardening`).

### 2026-09-30 — Claude — Hardening, Activity-feed cleanup, reorg handling, mobile
- Security: nonce-based CSP and security headers on every response, same-origin CSRF check on form posts (Basic Auth is auto-sent by browsers), 16 KB body cap, per-IP rate limit on writes, address validation on route params, `/healthz` no longer risks exposing RPC details. New optional env: `PUBLIC_URL`, `TRUST_PROXY`.
- Activity feed: each payment now shows once (memo transfers emit both `Transfer` and `TransferWithMemo` — previously fanned out into two rows); per-tx fee debits are labeled "network fee"; Payments stat excludes fee debits. Total spent unchanged (still reconciles with the chain).
- Indexer: atomic per-range writes (rows + cursor), skips undecodable logs instead of stalling, detects reorgs via the last indexed block hash and rewinds.
- Mobile: tables collapse into labeled cards on narrow screens; auto-refresh no longer wipes a half-typed agent name.
- Devnet fixture now mirrors real Tempo more closely (dual transfer events, optional per-tx fee debit, `dev_reorg`). New `test/hardening.test.ts`; 26 tests pass, typecheck clean.
- Handoff: PR `claude/hackathon-hardening`. On Railway, set `TRUST_PROXY=1` (and optionally `PUBLIC_URL`).

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
