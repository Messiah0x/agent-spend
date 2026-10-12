# Caula spending-control verification

## Automated devnet proof

Run `npm ci && npm test -- test/controls.test.ts`.

The existing end-to-end suite starts an isolated simulated Tempo JSON-RPC server and exercises:

1. Authorize an agent with a 20 pathUSD spending limit.
2. Spend 15 pathUSD successfully; index the transaction and confirm 5 pathUSD remains.
3. Attempt another 10 pathUSD; assert `BudgetExceededError` and no payment.
4. Submit an authenticated approval request for 10 pathUSD.
5. Verify unauthenticated and cross-origin approval attempts fail.
6. Approve the request, verify the on-chain limit changes, and retry the 10 pathUSD payment successfully.
7. Verify transaction history, audit trail, replay protection, and revoke behavior.

These tests **do not prove** connectivity or enforcement on the public Tempo Moderato testnet. They are a simulated-chain regression gate.

## Public testnet gate (not yet performed)

- Use a dedicated, funded testnet account and an agent key with no production privileges.
- Confirm Moderato RPC health and chain ID before signing.
- Authorize a small token spending limit on-chain.
- Submit one in-budget transfer and record the receipt.
- Attempt an over-budget transfer; verify on-chain rejection or SDK refusal and no balance movement.
- Check indexed activity, alerts, and remaining limits.
- Revoke the test agent key and verify subsequent spending fails.

Never put a private key in a public preview or commit it to GitHub. The Caula preview currently has no operator key configured.

## Production storage gate

The current production SQLite database is on an unmounted filesystem. A persistent volume and DB_PATH change have been staged for the original service, **not applied**. Obtain and verify a backup of the existing DB before committing those changes. The isolated Caula preview has a separate temporary database.
