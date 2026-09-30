// Live agent: drives the REAL Tempo Moderato testnet through the milestone
// flow — fund the root account from the official faucet (tempo_fundAddress),
// authorize an agent access key with a monthly pathUSD budget, then make
// memo-tagged payments signed by the access key. Run the dashboard with
// WATCHED_ACCOUNTS=<root address> against the same RPC to watch it appear.
//
// Testnet only. Keys live in .local/ (gitignored); never fund them with real
// assets.
//
// Usage:
//   npm run live-agent            # generates .local/ keys on first run
//   TEMPO_RPC_URL=… npm run live-agent

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient, http, keccak256, toHex, publicActions, type Address } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { tempoModerato } from "viem/chains";
import { tempoActions, Account } from "viem/tempo";
import { MODERATO_RPC_URL, PATH_USD_ADDRESS, TIP20_DECIMALS } from "../src/chain.js";
import { createAgent } from "../src/sdk.js";

const RPC_URL = process.env.TEMPO_RPC_URL ?? MODERATO_RPC_URL;
const ROOT_KEY_FILE = ".local/moderato-test-key.json";
const AGENT_KEY_FILE = ".local/moderato-agent-key.json";
const USD = 10n ** BigInt(TIP20_DECIMALS);

interface KeyFile {
  address: Address;
  privateKey: `0x${string}`;
}

function loadOrCreateKey(path: string, label: string): KeyFile {
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as KeyFile;
  const privateKey = generatePrivateKey();
  const address = Account.fromSecp256k1(privateKey).address;
  mkdirSync(".local", { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        note: `TESTNET-ONLY ${label} key for Tempo Moderato validation. Never fund with real assets.`,
        address,
        privateKey,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`generated new ${label} key → ${path}`);
  return { address, privateKey };
}

function memoFor(reason: string) {
  return keccak256(toHex(reason));
}

async function main() {
  console.log(`live agent → ${RPC_URL}`);

  const rootKey = loadOrCreateKey(ROOT_KEY_FILE, "root-account");
  const agentKey = loadOrCreateKey(AGENT_KEY_FILE, "agent-access");

  const root = Account.fromSecp256k1(rootKey.privateKey);
  // The agent's key signs through the keychain envelope on behalf of root.
  const agentAccessKey = Account.fromSecp256k1(agentKey.privateKey, { access: root });

  const rootClient = createClient({
    account: root,
    chain: tempoModerato,
    transport: http(RPC_URL),
  })
    .extend(publicActions)
    .extend(tempoActions());
  const agentClient = createClient({
    account: agentAccessKey,
    chain: tempoModerato,
    transport: http(RPC_URL),
  })
    .extend(publicActions)
    .extend(tempoActions());

  const chainId = await rootClient.getChainId();
  if (chainId !== tempoModerato.id) {
    throw new Error(`connected chain ${chainId} is not Moderato (${tempoModerato.id}) — refusing to continue`);
  }
  console.log(`connected: chain ${chainId}, block ${await rootClient.getBlockNumber()}`);
  console.log(`root account (watch this): ${root.address}`);
  console.log(`agent access key:          ${agentAccessKey.accessKeyAddress}`);

  // 1. Fund from the official faucet when the balance can't cover the run.
  const balance = await rootClient.token.getBalance({
    account: root.address,
    token: PATH_USD_ADDRESS,
  });
  console.log(`1. pathUSD balance: ${balance.formatted}`);
  if (balance.amount < 100n * USD) {
    console.log("   requesting faucet funds (tempo_fundAddress)…");
    await rootClient.faucet.fundSync({ account: root.address });
    const funded = await rootClient.token.getBalance({
      account: root.address,
      token: PATH_USD_ADDRESS,
    });
    console.log(`   funded — pathUSD balance now ${funded.formatted}`);
  }

  // 2. Authorize the agent access key: 500 pathUSD per 30 days.
  //    Idempotent: a re-run against an already-authorized key hits
  //    KeyAlreadyExists on-chain — that's success, not failure.
  console.log("2. authorizing agent access key (500 pathUSD / 30 days)…");
  try {
    const auth = await rootClient.accessKey.authorizeSync({
      accessKey: agentAccessKey,
      limits: [{ token: PATH_USD_ADDRESS, limit: 500n * USD, period: 30 * 24 * 3600 }],
    });
    console.log(`   authorized in tx ${auth.receipt.transactionHash}`);
  } catch (err) {
    if (String(err).includes("KeyAlreadyExists")) {
      console.log("   already authorized on-chain, skipping");
    } else {
      throw err;
    }
  }

  // 3. Agent makes real memo-tagged payments via the access key.
  const payments = [
    { to: "0x00000000000000000000000000000000000a9e27" as Address, amount: 12_500_000n, reason: "LLM inference credits, batch #4821" },
    { to: "0x00000000000000000000000000000000000da7a2" as Address, amount: 4_990_000n, reason: "Market data snapshot 2026-08-28" },
  ];
  // With AGENT_SPEND_URL set (a dashboard watching this root account), pay
  // through the Agent SDK so each payment carries a signed reason record.
  // Otherwise fall back to a bare memo (hash of the reason text).
  const agentSpendUrl = process.env.AGENT_SPEND_URL;
  const sdkAgent = agentSpendUrl
    ? createAgent({ baseUrl: agentSpendUrl, account: root.address, privateKey: agentKey.privateKey, rpcUrl: RPC_URL })
    : null;
  if (sdkAgent) {
    console.log(`   paying via Agent SDK → ${agentSpendUrl} (waiting for the key to be indexed)…`);
    const deadline = Date.now() + 60_000;
    while (!(await fetch(`${agentSpendUrl}/api/v1/agents/${root.address}/${sdkAgent.keyId}`).then((r) => r.ok, () => false))) {
      if (Date.now() > deadline) throw new Error("dashboard never indexed the agent key");
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
  for (const p of payments) {
    const txHash = sdkAgent
      ? (await sdkAgent.pay({ to: p.to, amount: p.amount, reason: p.reason })).txHash
      : (
          await agentClient.token.transferSync({
            token: PATH_USD_ADDRESS,
            to: p.to,
            amount: p.amount,
            memo: memoFor(p.reason),
          })
        ).receipt.transactionHash;
    console.log(
      `3. paid ${Number(p.amount) / Number(USD)} pathUSD to ${p.to.slice(0, 10)}… ` +
        `(reason: "${p.reason}") tx ${txHash}`,
    );
  }

  // 4. Read the live remaining budget the same way the dashboard does.
  const { remaining } = await agentClient.accessKey.getRemainingLimit({
    account: root.address,
    accessKey: agentAccessKey,
    token: PATH_USD_ADDRESS,
  });
  console.log(`4. remaining budget (on-chain): ${Number(remaining) / Number(USD)} pathUSD`);

  console.log("\ndone — run the dashboard against the same RPC to see it:");
  console.log(`   WATCHED_ACCOUNTS=${root.address} TEMPO_RPC_URL=${RPC_URL} npm run dev`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
