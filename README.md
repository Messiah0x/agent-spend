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

## What works today

Agent Spend is a working, tested product on Tempo — the full loop of **provision → spend with a reason → observe → escalate → approve on-chain → revoke**:

| | |
|---|---|
| **Observe** | Discovers every agent access key on watched accounts; live remaining budgets (read from the chain, never cached) with %-of-limit bars; total spend, payment count, per-agent burn rate, runway, 30-day spend chart and top recipients; full key-policy history. No agent integration required. |
| **Explain** | Every payment can carry a **signed reason**. The reason record's hash is the on-chain memo, so each payment shows *why* it happened — marked **Verified** when the chain's payment matches what the agent signed, **Mismatch** when it doesn't — with a per-payment proof page anyone can check. |
| **Control** | From the dashboard: authorize a new agent with a native Tempo spending limit, change a limit, or revoke a key (kill switch). Each is a real AccountKeychain transaction, logged in an operator audit trail. |
| **Escalate** | An agent that hits its limit asks for more budget (signed request). The owner gets a webhook, reviews it on **Approvals**, and approving raises the limit **on-chain** — the agent's retry then succeeds. Denials carry a note back to the agent. |
| **Alert** | "Needs attention" on the Overview for low/exhausted budgets and pending requests; optional Slack-compatible webhook alerts, sent once per budget period. |
| **Integrate** | TypeScript Agent SDK (`agent.pay(...)` with a live-budget pre-check), an **MCP server** so any MCP agent can pay with a reason and request budget, and a JSON API. |

Everything persists in SQLite, survives restarts without duplicating events, recovers from chain reorgs, and runs as a single deployed process (Railway).

## Architecture

Tempo's AccountKeychain enforces agent spending policy on-chain (per-key budgets, periodic limits, recipient allowlists). Agent Spend is the management layer on top: **visibility, transaction context, and human control**. See [ARCHITECTURE.md](./ARCHITECTURE.md).

- **Indexer** (`src/indexer.ts`) — polls `eth_getLogs` for `AccessKeySpend`, `KeyAuthorized`, `KeyRevoked`, `SpendingLimitUpdated` on the AccountKeychain precompile, plus `Transfer`/`TransferWithMemo` on configured TIP-20 tokens. Atomic per-range writes, idempotent, reorg-aware.
- **Dashboard** (`src/server.ts`) — server-rendered, no client framework: Overview, Agent pages, Activity, Payment proof, Approvals, Keys.
- **Reasons ledger** (`src/reasons.ts`) — reason records, canonical hashing, verification against indexed payments.
- **Approvals** (`src/approvals.ts`) — signed budget requests; approval executes `updateSpendingLimit`.
- **Operator writer** (`src/writer.ts`) — submits control transactions with an **admin access key** (TIP-1049), so the root key never touches the server. Optional: without it, on-chain state is read-only from the dashboard.
- **Agent API / SDK / MCP** (`src/api.ts`, `src/sdk.ts`, `src/mcp.ts`) — agents authenticate by signing with their own access key: no shared API secrets.

## Quickstart (local demo, 2 terminals)

```sh
npm install

# 1. Devnet fixture + dashboard (with on-chain controls wired to the fixture)
npm run demo:stack            # → http://localhost:3000   admin: demo / demo-password

# 2. Demo agent: gets a 500 pathUSD/month key, makes three payments with
#    signed reasons, then tries a 480 pathUSD purchase it can't afford and
#    asks for more budget.
npm run demo
```

Then, in the browser:

1. **Overview** — the agent, its live budget bar, and "1 budget request awaiting review".
2. **Activity** — each payment with its reason and a **Verified** badge; click one for the proof (record hash = on-chain memo, signer = the agent's key).
3. **Approvals** — approve the request (log in as `demo` / `demo-password`). The limit is raised on-chain; the waiting demo agent retries and the 480 pathUSD payment goes through.
4. **Agent page** — burn rate, runway, spend chart, controls (set limit, **Revoke key**), and the audit trail of what you just did.

Prefer separate processes? `npm run devnet` + `WATCHED_ACCOUNTS=0x1111111111111111111111111111111111111111 TEMPO_RPC_URL=http://localhost:8545 CONFIRMATIONS=0 OPERATOR_MODE=devnet ADMIN_USER=demo ADMIN_PASSWORD=demo-password npm run dev` + `npm run demo`.

## Against Tempo testnet (Moderato)

```sh
WATCHED_ACCOUNTS=<your root account> npm run dev
```

To see real payments with reasons: `AGENT_SPEND_URL=http://localhost:3000 npm run live-agent` (funds a fresh testnet account from the faucet, authorizes a 500 pathUSD/30-day agent key, and pays through the SDK). Validated live on Moderato; see CHANGELOG.

To enable on-chain controls, authorize an admin access key for the account and set `OPERATOR_MODE=admin`, `OPERATOR_PRIVATE_KEY=<admin key>`. New agents generate their own keys locally with `npm run new-agent-key` — only the address is given to the dashboard.

### Configuration

All settings are environment variables (see [`.env.example`](./.env.example)). Defaults verified against the [tempoxyz/tempo](https://github.com/tempoxyz/tempo) sources.

| Setting | Default |
|---|---|
| `WATCHED_ACCOUNTS` | **required** — comma-separated root accounts |
| `TEMPO_RPC_URL` | `https://rpc.moderato.tempo.xyz` |
| `TEMPO_CHAIN_ID` | `42431` (Moderato testnet; mainnet "Presto" is `4217`) |
| `TOKENS` | `0x20C0000000000000000000000000000000000000:pathUSD` |
| `START_BLOCK` / `CONFIRMATIONS` | `0` / `2` |
| `DB_PATH` / `PORT` | `./data/agent-spend.db` / `3000` |
| `EXPLORER_URL` | unset (tx links off) |
| `ADMIN_USER` / `ADMIN_PASSWORD` | unset — **all dashboard writes fail closed (503) until both are set** |
| `PUBLIC_URL` | unset — public origin, used for CSRF checks and links in notifications |
| `TRUST_PROXY` | unset — set `1` behind a reverse proxy (Railway) so rate limits use `X-Forwarded-For` |
| `OPERATOR_MODE` | unset (controls off) — `admin` (recommended), `root` (testnet only), `devnet` (local only) |
| `OPERATOR_ACCOUNT` / `OPERATOR_PRIVATE_KEY` | account the operator controls (defaults to the only watched account) / its key |
| `ALERT_THRESHOLD_PCT` | `20` — "low budget" below this % of the limit |
| `WEBHOOK_URL` | unset — https webhook (Slack-compatible `{text}`) for approval requests and budget alerts |

AccountKeychain precompile: `0xaAAAaaAA00000000000000000000000000000000`.

## Security model

- **Tempo is the enforcement boundary.** Limits are native AccountKeychain spending limits; every control action (authorize, set limit, revoke, approve) is an on-chain transaction. A compromised Agent Spend server can't let an agent spend beyond what the chain allows, and holds no root key in the recommended `admin` operator mode.
- **Agents authenticate by signature.** Reason records and budget requests are EIP-191-signed by the agent's own access key and accepted only from keys the watched account has authorized on-chain and not revoked. No shared API secrets exist to leak.
- **Operator writes** (naming, controls, approvals) require HTTP Basic Auth and **fail closed** until `ADMIN_USER`/`ADMIN_PASSWORD` are set. Approvals are claimed atomically, so a double-submit can't execute twice; decisions and on-chain writes go to an audit log.
- **Web hardening:** strict CSP with per-request nonces (no inline styles/scripts without it, no third-party origins, no framing); same-origin CSRF checks on every form post; `nosniff`, `no-referrer`, HSTS over HTTPS; 16 KB body cap; per-IP rate limits on writes; strict validation of every address, amount and record field; no open redirects; flash messages are fixed strings, never URL text; all output HTML-escaped; webhook text Slack-escaped; errors never echo RPC URLs (which can carry provider API keys).
- **Honest limits:** Basic Auth is one shared operator credential, not multi-user auth. Only secp256k1 agent keys can sign API requests today (P256/WebAuthn keys can still pay; their payments just appear without a signed reason).

## Agent SDK, MCP, and API

```ts
import { createAgent, BudgetExceededError } from "./src/sdk.js";

const agent = createAgent({ baseUrl: "https://your-agent-spend", account: ROOT_ACCOUNT, privateKey: AGENT_KEY });

try {
  await agent.pay({ to: VENDOR, amount: 12_500_000n, reason: "LLM credits, batch #4821", context: { externalId: "inv_4821" } });
} catch (err) {
  if (err instanceof BudgetExceededError) {
    const req = await agent.requestApproval({ amount: err.requested - err.remaining, reason: "Batch #4822 needs more credits" });
    const decision = await agent.waitForApproval(req.id); // "approved" → the on-chain limit was raised
  }
}
```

`pay` pre-checks the live on-chain budget (throws `BudgetExceededError` before sending anything), registers the signed reason, then pays with `transferWithMemo`. The agent holds only its own access key.

**MCP server** — `npm run mcp` exposes `get_budget`, `pay`, `request_approval`, and `check_approval` over stdio, so any MCP-capable agent (Claude Code, Claude Desktop, …) can spend with a reason and ask a human for more. Env: `AGENT_SPEND_URL`, `AGENT_ACCOUNT`, `AGENT_PRIVATE_KEY`, `TEMPO_RPC_URL` (`AGENT_SPEND_DEVNET=1` for the local fixture). Example Claude Code config:

```json
{ "mcpServers": { "agent-spend": { "command": "npx", "args": ["tsx", "src/mcp.ts"],
  "env": { "AGENT_SPEND_URL": "http://localhost:3000", "AGENT_ACCOUNT": "0x…", "AGENT_PRIVATE_KEY": "0x…" } } } }
```

**JSON API** (`/api/v1`; reads are public like the dashboard, writes are agent-signed):

| Route | Purpose |
|---|---|
| `GET /agents` · `GET /agents/:account/:keyId` | Agents: name, status, spend, live budgets |
| `GET /payments?account=&keyId=&limit=` | Payments with reason + verdict |
| `GET /reasons/:memo` | Reason record, signature, matching payment, verdict |
| `POST /reasons` | Register a reason: `{ record, signature }` → `{ memo }` |
| `GET /approvals?status=&keyId=` · `GET /approvals/:id` | Budget requests and their status |
| `POST /approvals` | Request more budget: `{ request, signature }` → `{ id, status }` |

## Where this goes next

MPP 402 auto-handling in the SDK, one-time payment keys scoped to a single approved purchase (short expiry, recipient allowlist), recipient-allowlist management from the UI, multi-user auth with roles, per-category budgets, and analytics across agent fleets.

## Test

```sh
npm test          # 71 end-to-end tests against the devnet fixture
npm run typecheck
```

Suites: `e2e` (agent pays → dashboard), `hardening` (headers, CSRF, XSS, reorgs, feed classification), `reasons` (signed reasons, verification, API auth, MCP), `controls` (escalation → on-chain approval → retry, revoke/limit/authorize, alerts, redirect safety). CI runs both on every PR.
