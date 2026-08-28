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

Status: everything is prepared; execution is blocked only on network access.
- `npm run live-agent` (`scripts/live-agent.ts`) drives the full flow against
  Moderato with real transactions: faucet funding via `tempo_fundAddress`
  (the official faucet mints pathUSD, which also pays fees — Tempo has no
  native gas token), access-key authorization with a 500 pathUSD / 30-day
  limit, and memo-tagged payments signed by the access key (viem ≥2.55 ships
  native Tempo support in `viem/tempo`).
- Testnet-only keys live in `.local/` (gitignored). Watched root account:
  `0xDaAF9558c0C3BbBFf9cfA07A1a66430C33683F29`.
- Blocker: the remote dev environment's egress policy denies
  `rpc.moderato.tempo.xyz`; the founder needs to allow that domain (or run
  the two commands locally).

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
