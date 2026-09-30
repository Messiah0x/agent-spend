# Agent Spend — Product

## One-line description
Agent Spend is a spend management platform that lets companies track and control how their AI agents spend money.

## Product thesis
Tempo provides the onchain policy and access-key infrastructure. Agent Spend is the control room companies use to provision, observe, explain, approve, and manage agent spending.

## Target users
- AI-agent teams
- Crypto-native companies
- Finance / operations teams managing autonomous software spend

## Current MVP goal
Prove the full live flow on Tempo:
1. A real agent has a scoped Tempo access key.
2. The agent makes a real payment.
3. Agent Spend indexes it automatically.
4. The dashboard shows the agent, amount, recipient, memo, transaction, and remaining budget.

## Current priorities
1. Live Tempo testnet validation — done, validated live on Moderato 2026-08-28
2. Agent labels / identity — shipped (merged to main)
3. Reasons ledger — built 2026-09-30 (signed reasons, memo-linked, verified on the dashboard; Agent SDK + MCP server)
4. Approval / escalation workflows — built 2026-09-30 (agent-signed requests, on-chain approval, webhook notifications)
5. Key lifecycle and provisioning UI — built 2026-09-30 (authorize / set limit / revoke from the dashboard via an admin operator key)
5b. Alerts + agent analytics — built 2026-09-30 (low-budget alerts, burn rate, runway, spend chart)
6. Credit and yield later

## Agent Identity (MVP)
Let a user attach a human-readable name to an agent access key — entirely
within Agent Spend, never Tempo:
1. Name an agent inline from the Overview page.
2. Rename it any time, same place.
3. The name shows everywhere the raw address used to: Overview, Activity, Keys.
4. The address stays visible as secondary information — the name never hides it.
5. Unnamed agents render exactly as before this feature existed.

**Status: shipped (merged to main).** See ENGINEERING.md and CHANGELOG.md.

## Hackathon demo (2026-09-30)
`npm run demo:stack` + `npm run demo`: an agent pays three vendors with signed reasons (Verified on the dashboard), tries a purchase it can't afford, is stopped before anything is sent, asks for more budget; the owner approves on the Approvals page, the limit is raised on-chain, the agent's retry succeeds, and the owner can revoke the key with one click. See README "Quickstart".

## Non-goals for now
- Rebuilding Tempo's native spending-rule engine
- Multi-tenant enterprise auth
- Credit underwriting
- Yield products
- Large feature expansion before live Tempo validation

## Team roles
- Founder: final decisions and public voice
- ChatGPT: product strategy, prioritization, positioning, review
- Claude: engineering and implementation
- Grok: X marketing strategy, narratives, engagement, distribution
- ComfyUI: visual asset production

## Product principle
Tempo is the policy engine. Agent Spend is the control room.
