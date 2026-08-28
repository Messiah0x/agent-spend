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
- Local devnet fixture and automated tests

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
- Improve mobile table overflow after live validation.
- Review event association for transactions containing multiple relevant events.
- Consider deeper reorg handling later.

## Do not build yet
- Reasons ledger
- Approval workflow
- Full key provisioning UI
- Multi-tenant auth
- Credit / yield

Do not expand scope until the live Tempo milestone works.
