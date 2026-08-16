// Demo agent: drives the devnet fixture through the milestone flow —
// authorize an agent access key with a monthly budget, then make payments
// with memos. Run the dashboard against the same devnet to watch it appear.

import { keccak256, toHex, getAddress } from "viem";
import { PATH_USD_ADDRESS } from "../src/chain.js";

const RPC_URL = process.env.TEMPO_RPC_URL ?? "http://localhost:8545";

// Fixed demo identities (any addresses work; these are stable for the demo).
export const DEMO_ACCOUNT = getAddress("0x1111111111111111111111111111111111111111");
export const DEMO_AGENT_KEY = getAddress("0x2222222222222222222222222222222222222222");
const VENDOR_API = getAddress("0x3333333333333333333333333333333333333333");
const VENDOR_DATA = getAddress("0x4444444444444444444444444444444444444444");

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

function memoFor(reason: string) {
  return keccak256(toHex(reason));
}

const USD = 1_000_000n; // TIP-20 tokens use 6 decimals

async function main() {
  console.log(`demo agent → ${RPC_URL}`);

  console.log("1. authorizing agent access key (500 pathUSD / 30 days)…");
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

  const payments = [
    { to: VENDOR_API, amount: 12_500_000n, reason: "LLM inference credits, batch #4821" },
    { to: VENDOR_DATA, amount: 4_990_000n, reason: "Market data snapshot 2026-08-16" },
    { to: VENDOR_API, amount: 25_000_000n, reason: "LLM inference credits, batch #4822" },
  ];
  for (const p of payments) {
    const result = await rpc<{ txHash: string; remaining: string }>("dev_pay", [
      {
        account: DEMO_ACCOUNT,
        keyId: DEMO_AGENT_KEY,
        token: PATH_USD_ADDRESS,
        to: p.to,
        amount: p.amount.toString(),
        memo: memoFor(p.reason),
      },
    ]);
    console.log(
      `2. paid ${Number(p.amount) / 1e6} pathUSD to ${p.to.slice(0, 8)}… ` +
        `(memo: "${p.reason}") tx ${result.txHash.slice(0, 10)}… remaining ${Number(result.remaining) / 1e6}`,
    );
  }

  // Mine a couple of empty blocks so the payments clear the dashboard's
  // confirmation trailing window.
  await rpc("dev_mine");
  await rpc("dev_mine");

  console.log("done — open the dashboard to see the agent, payments, and remaining budget.");
  console.log(`   (watched account: ${DEMO_ACCOUNT})`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
