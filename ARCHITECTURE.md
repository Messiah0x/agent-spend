# agent-spend — Architecture

Spend management and financial controls for autonomous AI agents, built on Tempo.

**Principle: Tempo is the policy engine; agent-spend is the control room.**
Tempo enforces spending rules in-protocol. We never re-implement a limit the
chain can enforce. Our product provisions, observes, explains, and escalates.

## What Tempo natively provides

### Access keys (AccountKeychain precompile)

A root key (e.g. a human's passkey) provisions scoped access keys that sign
transactions on the account's behalf. Enforcement is consensus-level, per key:

- **Expiry** timestamps per key, and instant revocation (`revokeKey`).
- **Per-token spending limits** — one-time caps or **periodic caps that reset
  on a fixed interval** ([TIP-1011], live on mainnet; its stated use case
  includes "rate-limited agent/API budgets", e.g. 10 USDC/month). The chain
  reverts `SpendingLimitExceeded` when a key would exceed its budget.
- **Call scoping** — restrict a key to specific contract targets and function
  selectors; for TIP-20 `transfer` / `approve` / `transferWithMemo`, restrict
  to a **recipient allowlist** (natively enforced merchant allowlists).
- **Admin keys** ([TIP-1049]) — a key flagged `admin` may authorize/revoke
  other keys, so a platform can manage a fleet of agent keys under one
  account without holding the root key.
- Access keys cannot deploy contracts at the transaction level.

Observability is built in:

- `AccessKeySpend(account indexed, publicKey indexed, token indexed, amount, remainingLimit)`
  is emitted on **every** limit deduction — free per-agent spend attribution.
- `KeyAuthorized`, `KeyRevoked`, `SpendingLimitUpdated`, `AdminKeyAuthorized`
  events cover the key lifecycle.
- Read APIs: `getKey`, `getRemainingLimit`, `getRemainingLimitWithPeriod`,
  `getAllowedCalls`, `isAdminKey`, `getTransactionKey`.

### MPP (Machine Payments Protocol)

An open HTTP standard (Stripe + Tempo co-authored) built on 402 responses:

1. Server responds `402` with a `WWW-Authenticate: Payment` challenge
   (amount, currency = TIP-20 token address, recipient, `description`,
   `externalId`, optional memo, expiry).
2. Client signs a Tempo transaction (type `0x76`) and retries with an
   `Authorization: Payment` credential (`pull` mode: server broadcasts;
   `push` mode: client broadcasts and presents the tx hash).
3. Server settles and returns a `Payment-Receipt` header.

Intents: `charge` (one-shot), `session` (streaming payment channels with
off-chain vouchers — designed for per-token LLM metering), `subscription`.

There is an **MCP / JSON-RPC transport spec**: a tool call fails with error
`-32042` carrying challenges, and the credential/receipt ride in `_meta`.
This is exactly how AI agents will encounter payments in the wild.

### Memos

TIP-20 has `transferWithMemo(to, amount, bytes32 memo)` with an indexed
`TransferWithMemo` event. The memo is **32 bytes** — a reference, not prose.
MPP challenges carry `description` and `externalId`. Conclusion: the
human-readable *reason* for a spend lives off-chain, keyed to the chain by
the memo value.

## Product architecture

One agent = one access key. The key's native scopes *are* its spending
policy. Four components:

### 1. Key lifecycle service (write path)

Creates an agent by provisioning a scoped access key (limits, period,
recipient allowlist, expiry) via the account's root or admin key. Edits
budgets via `updateSpendingLimit` / `setAllowedCalls`. Kill switch is
`revokeKey`. Our database stores identity metadata only (agent name, owner,
key id) — never the rules; the chain is the source of truth, read back via
`getAllowedCalls` / `getRemainingLimitWithPeriod`.

### 2. Spend indexer (read path)

Tails `AccessKeySpend`, `Transfer` / `TransferWithMemo`, `KeyAuthorized`,
`KeyRevoked`, and `SpendingLimitUpdated` into a database. Because
`AccessKeySpend` is indexed by key, per-agent attribution requires no agent
instrumentation. Powers the dashboard: live budget remaining, burn rate,
spend by agent/token/recipient, key lifecycle history.

### 3. Reasons ledger

The agent SDK requires a reason for every spend. We store the full record
off-chain (reason text, MPP challenge context — realm, `description`,
`externalId` — and the receipt), compute a `bytes32` id (hash of the
record), and the agent pays with `transferWithMemo` carrying that id. The
indexed on-chain memo joins every transfer back to its full explanation,
verifiable in both directions. Spends that arrive via MPP get most of their
context from the challenge automatically.

### 4. Approval workflow

An agent that hits its limit or an unlisted recipient *cannot* spend — the
chain guarantees it. Escalation turns that hard stop into a request:

1. Agent submits intent + reason (typically after a local scope pre-check
   or an on-chain revert).
2. Owner is notified and reviews.
3. Approval executes a root/admin-key transaction: raise the periodic
   limit, add the recipient, or provision a one-shot key scoped to exactly
   that payment (short expiry).

The approval is an on-chain state change, not a flag in our database — a
compromised agent-spend server still cannot move money.

### Agent SDK

TypeScript (viem + Tempo extensions). Holds the agent's access key. Exposes
`pay(recipient, amount, reason)`. Handles MPP `402` / `-32042` challenges
automatically, pre-checking scope locally to fail fast into the escalation
flow instead of an on-chain revert. Ships as an MCP server so any agent
gets spend-with-reason as a tool.

## What we deliberately do not build

- A custom policy engine or `/authorize`–`/execute` payment gateway. Agents
  sign directly with their own keys; the chain enforces. We are not in the
  hot path and never take custody of root keys.
- A parallel ledger. The "ledger" is an index of chain events enriched with
  reasons; it cannot drift from the truth.

## Build order

1. **Indexer + dashboard** — visibility works even for agents provisioned by
   other tools; zero-integration adoption. *(done)*
2. **Key lifecycle** — provision/edit/revoke agent keys.
3. **Reasons SDK** — memo-linked reasons, MPP/MCP client. *(done: signed
   reason records, SDK, MCP server — MPP 402 auto-handling still open)*
4. **Approvals** — escalation and root-key approval flow.

## Open items

- Spec drafts are `-00`; examples disagree on chain id (4217 vs 42431). Pin
  exact chain ids and token addresses against a live testnet before coding.
- docs.tempo.xyz / mpp.dev were unreachable from the research environment;
  findings come from the primary spec repos (authoritative, but re-verify
  against published docs when accessible).

## Sources

- [tempoxyz/mpp-specs](https://github.com/tempoxyz/mpp-specs) — core
  `Payment` HTTP auth scheme, tempo `charge` / `session` methods, MCP
  transport (`specs/extensions/transports/draft-payment-transport-mcp-00.md`).
- [tempoxyz/tempo](https://github.com/tempoxyz/tempo) —
  [`tips/tip-1011.md`][TIP-1011] (enhanced access key permissions),
  [`tips/tip-1049.md`][TIP-1049] (admin keys),
  `crates/contracts/src/precompiles/account_keychain.rs` and `tip20.rs`
  (live precompile interfaces).
- [Tempo docs](https://docs.tempo.xyz/) · [Tempo Transactions blog](https://tempo.xyz/blog/tempo-transactions/)

[TIP-1011]: https://github.com/tempoxyz/tempo/blob/main/tips/tip-1011.md
[TIP-1049]: https://github.com/tempoxyz/tempo/blob/main/tips/tip-1049.md
