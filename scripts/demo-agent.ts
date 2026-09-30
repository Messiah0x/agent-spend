// Demo agent: drives the devnet fixture through the full flow — authorize an
// agent access key with a monthly budget, then pay through the Agent SDK so
// every payment carries a signed, verifiable reason. Run the dashboard
// against the same devnet (see README) to watch it appear.

import { getAddress, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PATH_USD_ADDRESS } from "../src/chain.js";
import { BudgetExceededError, createAgent, devnetPayer } from "../src/sdk.js";

const RPC_URL = process.env.TEMPO_RPC_URL ?? "http://localhost:8545";
const AGENT_SPEND_URL = process.env.AGENT_SPEND_URL ?? "http://localhost:3000";

// Fixed demo identities. The agent key is derived from a public, DEMO-ONLY
// seed so the demo is reproducible — never use it for anything real.
export const DEMO_ACCOUNT = getAddress("0x1111111111111111111111111111111111111111");
export const DEMO_AGENT_PK = keccak256(toHex("agent-spend demo agent — devnet only"));
export const DEMO_AGENT_KEY = privateKeyToAccount(DEMO_AGENT_PK).address;
const VENDOR_API = getAddress("0x3333333333333333333333333333333333333333");
const VENDOR_DATA = getAddress("0x4444444444444444444444444444444444444444");

const USD = 1_000_000n; // TIP-20 tokens use 6 decimals
const FEE = 5_903n; // per-tx fee debited from the key's limit, as on Moderato

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result as T;
}

/** Wait until the dashboard has indexed the key (reasons are only accepted from known keys). */
async function waitForIndexed(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${AGENT_SPEND_URL}/api/v1/agents/${DEMO_ACCOUNT}/${DEMO_AGENT_KEY}`).catch(() => null);
    if (res?.ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`dashboard at ${AGENT_SPEND_URL} never indexed the agent key — is it running against ${RPC_URL}?`);
}

async function main() {
  console.log(`demo agent → devnet ${RPC_URL}, Agent Spend ${AGENT_SPEND_URL}`);

  console.log(`1. authorizing agent access key ${DEMO_AGENT_KEY} (500 pathUSD / 30 days)…`);
  try {
    await rpc("dev_authorizeKey", [
      {
        account: DEMO_ACCOUNT,
        keyId: DEMO_AGENT_KEY,
        signatureType: 0,
        expiry: 0,
        token: PATH_USD_ADDRESS,
        limit: (500n * USD).toString(),
        period: 30 * 24 * 3600,
      },
    ]);
  } catch (err) {
    console.log(`   ${err instanceof Error ? err.message : err}`);
  }
  await waitForIndexed();

  const agent = createAgent({
    baseUrl: AGENT_SPEND_URL,
    account: DEMO_ACCOUNT,
    privateKey: DEMO_AGENT_PK,
    payer: devnetPayer({ rpcUrl: RPC_URL, account: DEMO_ACCOUNT, keyId: DEMO_AGENT_KEY, fee: FEE }),
  });

  const payments = [
    {
      to: VENDOR_API,
      amount: 12_500_000n,
      reason: "LLM inference credits for the weekly market-research report, batch #4821",
      context: { realm: "api.inference.example", externalId: "inv_4821" },
    },
    {
      to: VENDOR_DATA,
      amount: 4_990_000n,
      reason: "Market data snapshot (equities, 2026-09-30) needed for the report's pricing section",
      context: { realm: "data.example", description: "EOD equities snapshot" },
    },
    {
      to: VENDOR_API,
      amount: 25_000_000n,
      reason: "LLM inference credits, batch #4822 — summarizing 40 analyst notes",
      context: { realm: "api.inference.example", externalId: "inv_4822" },
    },
  ];
  for (const p of payments) {
    const { txHash, memo } = await agent.pay(p);
    console.log(`2. paid ${Number(p.amount) / 1e6} pathUSD to ${p.to.slice(0, 8)}… — "${p.reason}"`);
    console.log(`   tx ${txHash.slice(0, 10)}…  memo ${memo.slice(0, 10)}… (hash of the signed reason)`);
  }

  // Mine a couple of empty blocks so the payments clear the dashboard's
  // confirmation trailing window.
  await rpc("dev_mine");
  await rpc("dev_mine");

  const [budget] = await agent.budgets();
  if (budget) console.log(`3. remaining budget (on-chain): ${Number(budget.remaining) / 1e6} ${budget.symbol}`);

  // 4. Escalation: a purchase bigger than what's left. The SDK refuses before
  //    anything is sent; the agent asks a human for more budget instead.
  const big = {
    to: VENDOR_DATA,
    amount: 480_000_000n,
    reason: "Annual license for the equities data feed (renewal due this week)",
  };
  try {
    await agent.pay(big);
  } catch (err) {
    if (!(err instanceof BudgetExceededError)) throw err;
    // Ask for the shortfall plus a cent of headroom: Tempo also debits the
    // per-transaction fee from the same limit.
    const shortfall = err.requested - err.remaining + 10_000n;
    console.log(`4. ${Number(big.amount) / 1e6} pathUSD exceeds the remaining budget — nothing sent.`);
    const req = await agent.requestApproval({ amount: shortfall, to: big.to, reason: big.reason });
    console.log(`   requested +${Number(shortfall) / 1e6} pathUSD (request ${req.id.slice(0, 10)}…)`);
    if (process.env.DEMO_NO_WAIT === "1") {
      console.log(`   review it at ${AGENT_SPEND_URL}/approvals`);
    } else {
      console.log(`   → approve or deny it at ${AGENT_SPEND_URL}/approvals  (waiting up to 10 min; Ctrl+C to stop)`);
      const decided = await agent.waitForApproval(req.id, { timeoutMs: 10 * 60_000, pollMs: 1_000 });
      console.log(`5. request ${decided.status}${decided.note ? ` — ${decided.note}` : ""}`);
      if (decided.status === "approved" && decided.txHash) {
        const { txHash } = await agent.pay(big);
        console.log(`   retried: paid ${Number(big.amount) / 1e6} pathUSD, tx ${txHash.slice(0, 10)}…`);
        await rpc("dev_mine");
      }
    }
  }
  console.log(`done — open ${AGENT_SPEND_URL}/activity to see each payment with its verified reason.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
