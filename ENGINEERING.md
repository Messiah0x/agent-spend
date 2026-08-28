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

## Known follow-ups
- Do not silently treat RPC/read failures as missing budgets; surface an unavailable/error state.
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
