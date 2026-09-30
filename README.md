# Agent Spend

**Spend management and financial controls for autonomous AI agents, built on [Tempo](https://tempo.xyz).**

Agent Spend is infrastructure for giving AI agents the ability to participate in the real economy without giving them unrestricted access to money. The goal is to make autonomous spending **programmable, observable, auditable, and controllable**.

Tempo's AccountKeychain provides the on-chain enforcement layer: an account can authorize individual agent access keys and give each key specific spending permissions such as budgets, periodic limits, and recipient allowlists. Agent Spend sits on top of that infrastructure as the management and visibility layer for humans operating those agents.

## What we're building

AI agents are becoming capable of doing increasingly useful work independently: researching products, purchasing services, paying APIs, managing infrastructure, executing business workflows, and coordinating with other agents. But an agent that can make decisions also needs a safe way to spend money while completing those decisions.

The traditional options are poor fits. Giving an agent a wallet with unrestricted funds creates obvious risk. Giving it a credit card or shared API credential makes permissions difficult to isolate. Building custom payment logic into every agent creates integration overhead and still leaves operators without a unified view of what their agents are doing.

**Agent Spend is intended to become the financial control plane for AI agents.**

Instead of handing an agent unrestricted financial authority, an operator creates an access key with an explicit policy. For example, an agent could receive a 500 pathUSD monthly budget and permission to pay only approved services. The agent can then operate autonomously inside those boundaries. Tempo enforces the rules on-chain, while Agent Spend gives the human operator a dashboard for understanding and managing that activity.

The long-term product is designed around four ideas:

1. **Control** — Humans decide how much an agent can spend and under what conditions.
2. **Autonomy** — Once permissions are established, agents can transact without asking a human to approve every individual payment.
3. **Transparency** — Operators can see which agent spent money, how much it spent, where the money went, and why.
4. **On-chain enforcement** — Critical spending restrictions are enforced by Tempo rather than relying only on application-level promises or an agent behaving correctly.

### The user experience

An operator should eventually be able to open Agent Spend and see their autonomous financial system at a glance:

- every active AI agent and its human-readable name;
- the Tempo account and access key associated with that agent;
- the agent's original and remaining spending budget;
- total spending across agents;
- individual payments with amount, recipient, memo/context, and transaction data;
- when each agent was last active;
- changes to access-key policies;
- revoked or inactive agents;
- clear audit history for understanding what happened after the fact.

The important design principle is that an AI agent should not need a custom Agent Spend SDK just so its operator can monitor it. Agent Spend watches the relevant Tempo accounts and reconstructs activity from on-chain events and state. An existing Tempo-enabled agent can therefore become visible in the dashboard without integrating a separate tracking library.

### Example

Imagine a company operates a purchasing agent responsible for acquiring online services. The company gives the agent its own Tempo access key with a 500 pathUSD monthly limit rather than giving it control of the company's entire wallet.

The agent can independently make legitimate purchases during the month. Each payment appears in Agent Spend with the agent identity, amount, recipient, memo, transaction, and remaining budget. If the agent reaches its authorized limit or attempts an action outside its policy, the underlying Tempo permissions provide the enforcement boundary.

This creates a model where **humans define the financial boundaries and agents operate autonomously inside them**.

## Current MVP

The current MVP proves the core monitoring and control model. It consists of a persistent indexer and a web dashboard that watch configured Tempo accounts.

Today it can:

- discover authorized agent access keys;
- monitor agent spending on Tempo;
- display live remaining budgets;
- show total spend and payment counts;
- associate payments with the agent that made them;
- show payment amount, recipient, memo, and transaction context;
- track key authorization, revocation, and spending-limit changes;
- assign human-readable names to agent access keys;
- persist indexed activity locally in SQLite;
- recover safely after restarts without duplicating indexed events;
- run continuously as a deployed service.

This MVP is deliberately focused. It demonstrates that an operator can watch an account and automatically obtain an understandable view of agent financial activity without modifying the agent itself.

## Where this can go

Agent Spend can grow from a monitoring dashboard into a broader financial operations layer for autonomous software. Potential extensions include creating and modifying agent spending policies from the interface, approval workflows for exceptional purchases, alerts and notifications, richer agent identities, organization/team accounts, analytics, category-level budgets, merchant controls, recurring allowances, multi-agent treasury management, and APIs that let agent platforms provision financial permissions programmatically.

The broader vision is simple: as AI agents move from generating information to taking economic actions, they need financial infrastructure designed for machine autonomy. Agent Spend aims to provide the human control, visibility, and accountability layer around that infrastructure.

## Architecture

Tempo's AccountKeychain enforces agent spending policy on-chain (per-key budgets, periodic limits, recipient allowlists). Agent Spend is the management layer on top: **visibility, transaction context, and human control**. See [ARCHITECTURE.md](./ARCHITECTURE.md).

The application has two primary pieces:

- **Indexer** — polls `eth_getLogs` for `AccessKeySpend`, `KeyAuthorized`, `KeyRevoked`, and `SpendingLimitUpdated` on the AccountKeychain precompile, plus `Transfer`/`TransferWithMemo` on configured TIP-20 tokens. Relevant activity is stored in SQLite. The indexer is restart-safe and idempotent.
- **Dashboard** — a server-rendered web interface showing agents, payments, remaining budgets, transaction context, and key-policy history. Remaining budgets are read live from `getRemainingLimitWithPeriod` rather than relying on a cached approximation.

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

Open http://localhost:3000 — the agent, its payments, and its live remaining budget are on the Overview and Activity pages.

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
| `ADMIN_USER` / `ADMIN_PASSWORD` | unset — see below |
| `PUBLIC_URL` | unset — public origin (e.g. `https://…up.railway.app`), accepted for CSRF origin checks |
| `TRUST_PROXY` | unset — set `1` behind a reverse proxy (Railway) so rate limits key on `X-Forwarded-For` |

AccountKeychain precompile: `0xaAAAaaAA00000000000000000000000000000000`.

### Protecting agent naming on a public deployment

The dashboard itself is read-only and meant to be viewed freely. Naming/renaming an agent (`POST /agents/:account/:keyId/label`) is the one write route, and it's guarded by HTTP Basic Auth: set both `ADMIN_USER` and `ADMIN_PASSWORD` to enable it. **Until both are set, that route fails closed (503)** — it does not fall back to being open.

This is deliberately not a full authentication system: it is one shared credential for a single operator, applied only to that route; every other page stays public with no login.

### Hardening

Every response carries a strict Content-Security-Policy (per-request nonce, no third-party origins, no framing) plus `nosniff`, `Referrer-Policy: no-referrer`, and HSTS over HTTPS. Browser form posts must be same-origin (CSRF protection — Basic Auth credentials are sent automatically by browsers, so this matters). Bodies are capped at 16 KB, write routes are rate-limited per client IP, route addresses are validated, and `/healthz` never exposes RPC details (provider URLs can embed API keys).

## Test

```sh
npm test          # end-to-end: agent pays → dashboard shows it
npm run typecheck
```
