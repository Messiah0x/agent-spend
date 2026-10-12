// One-shot real Moderato test: ephemeral keys, faucet-only funds, no persisted secrets.
// This script sends actual TESTNET transactions. Never run against mainnet.
import { createClient, http, publicActions } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { Account, tempoActions } from "viem/tempo";
import { tempoModerato } from "viem/chains";
import { MODERATO_RPC_URL, PATH_USD_ADDRESS } from "../src/chain.js";
import { createWriter } from "../src/writer.js";
import { loadConfig } from "../src/config.js";

const rpc = process.env.TEMPO_RPC_URL ?? MODERATO_RPC_URL;
const rootPrivateKey = generatePrivateKey();
const root = Account.fromSecp256k1(rootPrivateKey);
const agent = Account.fromSecp256k1(generatePrivateKey(), { access: root });
const recipient = Account.fromSecp256k1(generatePrivateKey()).address;
const client = createClient({ account: root, chain: tempoModerato, transport: http(rpc, { timeout: 15_000, retryCount: 2 }) }).extend(publicActions).extend(tempoActions());
const agentClient = createClient({ account: agent, chain: tempoModerato, transport: http(rpc, { timeout: 15_000, retryCount: 2 }) }).extend(publicActions).extend(tempoActions());
const usd = 1_000_000n;
async function main() {
  const chainId = await client.getChainId();
  if (chainId !== 42431) throw new Error("Refusing non-Moderato chain " + chainId);
  console.log("Moderato verified: chain", chainId, "account", root.address, "agent", agent.accessKeyAddress);
  await client.faucet.fundSync({ account: root.address });
  const balance = await client.token.getBalance({ account: root.address, token: PATH_USD_ADDRESS });
  if (balance.amount < 3n * usd) throw new Error("Faucet did not provide enough pathUSD");
  const auth = await client.accessKey.authorizeSync({
    accessKey: agent,
    limits: [{ token: PATH_USD_ADDRESS, limit: 2n * usd, period: 30 * 86400 }],
  });
  console.log("Authorized 2 pathUSD:", auth.receipt.transactionHash, "block:", auth.receipt.blockNumber.toString());
  const paid = await agentClient.token.transferSync({ token: PATH_USD_ADDRESS, to: recipient, amount: usd });
  console.log("Allowed 1 pathUSD:", paid.receipt.transactionHash, "block:", paid.receipt.blockNumber.toString());
  const before = await agentClient.accessKey.getRemainingLimit({ account: root.address, accessKey: agent, token: PATH_USD_ADDRESS });
  if (before.remaining <= 0n || before.remaining > usd) throw new Error("Unexpected remaining budget: " + before.remaining);
  console.log("Remaining after allowed payment (includes any fee charges):", before.remaining.toString());
  let rejected = false;
  try {
    await agentClient.token.transferSync({ token: PATH_USD_ADDRESS, to: recipient, amount: 2n * usd });
  } catch (err) {
    rejected = true;
    console.log("Over-limit transfer rejected:", err instanceof Error ? err.message.slice(0, 240) : String(err));
  }
  if (!rejected) throw new Error("CRITICAL: over-limit transfer succeeded");
  const after = await agentClient.accessKey.getRemainingLimit({ account: root.address, accessKey: agent, token: PATH_USD_ADDRESS });
  if (after.remaining > before.remaining || before.remaining - after.remaining > 100_000n) throw new Error("Unexpected budget change after rejected transfer: before=" + before.remaining + " after=" + after.remaining);
  // Owner-authorized budget increase and agent retry on the REAL network.
  // This proves on-chain escalation mechanics; dashboard approval API is tested separately.
  // Exercise the same ChainWriter used by Caula's approval route.
  // Ephemeral testnet root key stays inside CI, never on the preview service.
  const writerConfig = loadConfig({ WATCHED_ACCOUNTS: root.address, TEMPO_RPC_URL: rpc,
    OPERATOR_MODE: "root", OPERATOR_ACCOUNT: root.address, OPERATOR_PRIVATE_KEY: rootPrivateKey } as NodeJS.ProcessEnv);
  const writer = createWriter(writerConfig);
  if (!writer) throw new Error("Caula writer not initialized");
  const increaseHash = await writer.setLimit(agent.accessKeyAddress, PATH_USD_ADDRESS, 5n * usd);
  console.log("Caula ChainWriter raised limit to 5 pathUSD:", increaseHash);
  const raised = await agentClient.accessKey.getRemainingLimit({ account: root.address, accessKey: agent, token: PATH_USD_ADDRESS });
  if (raised.remaining < 2n * usd) throw new Error("Budget increase not reflected on-chain: " + raised.remaining);
  const retry = await agentClient.token.transferSync({ token: PATH_USD_ADDRESS, to: recipient, amount: 2n * usd });
  console.log("Agent retry succeeded (2 pathUSD):", retry.receipt.transactionHash, "block:", retry.receipt.blockNumber.toString());
  const finalBudget = await agentClient.accessKey.getRemainingLimit({ account: root.address, accessKey: agent, token: PATH_USD_ADDRESS });
  if (finalBudget.remaining >= raised.remaining) throw new Error("Retry did not consume allowance");
  console.log("PASS: Moderato rejected over-budget payment, owner increased limit, agent retry succeeded; remaining:", finalBudget.remaining.toString());
}
main().catch(err => { console.error("FAIL:", err instanceof Error ? err.message : err); process.exitCode = 1; });
