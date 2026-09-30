# Agent Spend — Engineering

## Owner
Claude

## Rule
Before coding, read PRODUCT.md and this file. Keep the implementation aligned with the current MVP. Update this file when meaningful engineering status changes.

## Current architecture
- TypeScript
- Hono server-rendered dashboard
- SQLite
- viem for Tempo/EVM interaction
- Event indexer for Tempo AccountKeychain and TIP-20 activity
- Tempo remains the source of truth for remaining spending limits

## Existing MVP
- Overview / Agents dashboard
- Activity / spend feed
- Keys / policy history
- Indexes key authorization, revocation, spending-limit updates, access-key spend, Transfer, and TransferWithMemo events
- Agent identity: human-readable labels for access keys, named/renamed from Overview, shown on Overview/Activity/Keys. Agent Spend's own data (local `agent_labels` table) — never written to Tempo, never affects on-chain enforcement. The write route (`POST /agents/:account/:keyId/label`) is guarded by HTTP Basic Auth (`ADMIN_USER`/`ADMIN_PASSWORD`) and fails closed (503) if either is unset — needed once the dashboard is on a public URL with no other auth in front of it. Read-only pages remain public.
- Local devnet fixture and automated tests
- Hardening (2026-09-30): nonce-based CSP + security headers, same-origin CSRF checks on form posts, 16 KB body limit, per-IP rate limiting on writes, address validation on route params, graceful shutdown, `/healthz` reports indexer health without leaking the RPC URL.
- Indexer (2026-09-30): each block range and its cursor commit in one SQLite transaction; undecodable logs are skipped with a warning instead of stalling the loop; reorg detection compares the stored hash of the last indexed block and rewinds 64 blocks on mismatch.
- Activity feed (2026-09-30): each budget debit renders once — a memo transfer's duplicate `Transfer`/`TransferWithMemo` pair is collapsed (memo-bearing row preferred), and fee-only debits are labeled "network fee". The Payments stat counts payments only; Total spent still includes fees (it must reconcile with on-chain remaining).
- Reasons ledger (2026-09-30): `src/reasons.ts` (record format, canonical JSON, keccak256 memo, strict validation, verification against the indexed payment), `reasons` table, `POST /api/v1/reasons` authenticated by the agent's own access-key signature (EIP-191 over the memo; key must be indexed, active, on a watched account; 1,000 records/key/day). Activity shows reason + Verified/Mismatch; `/payments/:txHash` shows the full proof. Only secp256k1 access keys can sign API requests today (P256/WebAuthn keys can still pay; their memos just show without a reason).
- Agent SDK + MCP (2026-09-30): `src/sdk.ts` (`createAgent().pay/registerReason/budgets`, pluggable `Payer`: real Tempo via `viem/tempo`, or devnet) and `src/mcp.ts` (stdio MCP server, `get_budget`/`pay`). `scripts/demo-agent.ts` and (with `AGENT_SPEND_URL`) `scripts/live-agent.ts` pay through the SDK.
- JSON API (2026-09-30): `/api/v1` agents/payments/reasons reads; JSON-only writes (415 otherwise; `text/plain` cross-site posts blocked by CSRF guard).
- Mobile (2026-09-30): tables collapse into labeled stacked cards under 720px; auto-refresh pauses while a form is being edited.

## Immediate engineering milestone
Validate the product against the real Tempo Moderato testnet.

Success means:
1. Configure a real watched Tempo account.
2. Provision/use a real Tempo access key.
3. Fund/use a real test TIP-20 token.
4. Make a real agent payment with a memo.
5. Index the live transaction.
6. Show it correctly in the dashboard with remaining budget.

**Status: validated live on Moderato, 2026-08-28.** Run locally (a prior
remote environment was network-blocked from `rpc.moderato.tempo.xyz`; this
run was done from a local machine instead). `npm run live-agent` funded a
fresh testnet-only account from the faucet, authorized a scoped agent access
key (500 pathUSD / 30 days), and made two real memo-tagged payments. The
dashboard, run against the same RPC, indexed both automatically and showed
the agent, amounts, recipients, memo commitments, transactions, and live
remaining budget (482.50 pathUSD), matching the on-chain read. See CHANGELOG.md.

- `npm run live-agent` (`scripts/live-agent.ts`) drives the full flow against
  Moderato with real transactions: faucet funding via `tempo_fundAddress`
  (the official faucet mints pathUSD, which also pays fees — Tempo has no
  native gas token), access-key authorization with a 500 pathUSD / 30-day
  limit, and memo-tagged payments signed by the access key (viem ≥2.55 ships
  native Tempo support in `viem/tempo`).
- Testnet-only keys live in `.local/` (gitignored, never committed). Watched
  root account this run: `0xc316BAb556742A2147341C8001Ea03Bbb2cDcdC9`.
- On Windows, `better-sqlite3` needs a native build; installing Visual Studio
  Build Tools (Desktop development with C++ workload) is required regardless
  of Node version.
- Fixed two bugs found during this run: an invalid checksummed placeholder
  recipient address in `live-agent.ts`, and non-idempotent access-key
  authorization (re-running against an already-authorized key now skips
  instead of failing on `KeyAlreadyExists`).
- The indexer's stored cursor takes precedence over `START_BLOCK` on restart
  — clear `data/*.db` if you need to change `START_BLOCK` on an existing DB.

## Known follow-ups
- ~~Improve mobile table overflow after live validation.~~ Done 2026-09-30.
- ~~Activity-feed dedupe / fee labeling.~~ Done 2026-09-30 (see Existing MVP). Original investigation notes kept below.
- Review event association for transactions containing multiple relevant events. Investigated 2026-08-29: each payment tx fires *two* `AccessKeySpend` events against the key's budget (the payment amount, plus a flat ~0.005903 pathUSD per-transaction fee debited from the same limit — separate from the network fee `Transfer` to the protocol's `0xfeec…` collector, which comes out of the root account's balance, not the key's budget). `spendTotals()` correctly sums both — this is why "Total spent" (e.g. 17.50) is larger than the sum of payment amounts alone (12.50 + 4.99 = 17.49): the fee debit is real and belongs in it, since it's what makes the figure reconcile with the on-chain remaining budget. Not a bug; do not "fix" by excluding fee-only spend rows. What's still open: the Activity feed's join fans one spend row out into two near-duplicate rows (once against the plain `Transfer`, once against `TransferWithMemo`) and shows the fee-only spend as an unlabeled "−0.00" row — worth deduping/labeling for clarity, but cosmetic.
- ~~Consider deeper reorg handling later.~~ Basic reorg detection + rewind done 2026-09-30.

## Do not build yet
- ~~Reasons ledger~~ — built 2026-09-30 (live milestone met; scope unlocked)
- Approval workflow
- Full key provisioning UI
- Multi-tenant auth
- Credit / yield

Do not expand scope until the live Tempo milestone works.
