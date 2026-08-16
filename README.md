# agent-spend

Spend management and financial controls for autonomous AI agents, built on [Tempo](https://tempo.xyz).

Tempo's AccountKeychain enforces agent spending policy on-chain (per-key budgets,
periodic limits, recipient allowlists). agent-spend is the management layer on
top: **visibility, transaction context, and human control**. See
[ARCHITECTURE.md](./ARCHITECTURE.md).

This MVP is the indexer + dashboard: watch Tempo accounts, and every agent
access key, payment (amount, recipient, memo, transaction), and live remaining
budget appears automatically — zero integration required in the agent.

## Quickstart (local demo)

Three terminals:

```sh
npm install

# 1. Local Tempo dev fixture (emits the real precompile events)
npm run devnet

# 2. Dashboard + indexer → http://localhost:3000
WATCHED_ACCOUNTS=0x1111111111111111111111111111111111111111 \
TEMPO_RPC_URL=http://localhost:8545 CONFIRMATIONS=0 npm run dev

# 3. Simulated agent: authorizes a key with a 500 pathUSD/month budget,
#    then makes memo-tagged payments
npm run demo
```

Open http://localhost:3000 — the agent, its payments, and its live remaining
budget are on the Overview and Activity pages.

## Against Tempo testnet (Moderato)

```sh
WATCHED_ACCOUNTS=<your account address> npm run dev
```

Defaults (verified against the [tempoxyz/tempo](https://github.com/tempoxyz/tempo) sources):

| Setting | Default |
|---|---|
| `TEMPO_RPC_URL` | `https://rpc.moderato.tempo.xyz` |
| `TEMPO_CHAIN_ID` | `42431` (Moderato testnet; mainnet "Presto" is `4217`) |
| `TOKENS` | `0x20C0000000000000000000000000000000000000:pathUSD` |
| `START_BLOCK` | `0` |
| `CONFIRMATIONS` | `2` |
| `DB_PATH` | `./data/agent-spend.db` |
| `PORT` | `3000` |
| `EXPLORER_URL` | unset (tx links off) |

AccountKeychain precompile: `0xaAAAaaAA00000000000000000000000000000000`.

## How it works

- **Indexer** polls `eth_getLogs` for `AccessKeySpend`, `KeyAuthorized`,
  `KeyRevoked`, and `SpendingLimitUpdated` on the AccountKeychain precompile,
  plus `Transfer`/`TransferWithMemo` on the configured TIP-20 tokens — filtered
  server-side to the watched accounts — into SQLite. Restart-safe and
  idempotent.
- **Dashboard** (server-rendered, no client framework) shows agents with
  remaining budgets read live from `getRemainingLimitWithPeriod` (never
  cached), the payment feed with recipient/memo/tx, and the key-policy audit
  trail.

## Test

```sh
npm test          # end-to-end: agent pays → dashboard shows it
npm run typecheck
```
