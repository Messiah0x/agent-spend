// One-shot real Moderato test: ephemeral keys, faucet-only funds, no persisted secrets.
// This script sends actual TESTNET transactions. Never run against mainnet.
import { createClient, http, publicActions } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { Account, tempoActions } from "viem/tempo";
import { tempoModerato } from "viem/chains";
import { MODERATO_RPC_URL, PATH_USD_ADDRESS } from "../src/chain.js";

const rpc = process.env.TEMPO_RPC_URL ?? MODERATO_RPC_URL;
const root = Account.fromSecp256k1(generatePrivateKey());
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
  console.log("Authorized 2 pathUSD:", auth.receipt.transactionHash);
  const paid = await agentClient.token.transferSync({ token: PATH_USD_ADDRESS, to: recipient, amount: usd });
  console.log("Allowed 1 pathUSD:", paid.receipt.transactionHash);
  const before = await agentClient.accessKey.getRemainingLimit({ account: root.address, accessKey: agent, token: PATH_USD_ADDRESS });
  if (before.remaining !== usd) throw new Error("Unexpected remaining budget: " + before.remaining);
  let rejected = false;
  try {
    await agentClient.token.transferSync({ token: PATH_USD_ADDRESS, to: recipient, amount: 2n * usd });
  } catch (err) {
    rejected = true;
    console.log("Over-limit transfer rejected:", err instanceof Error ? err.message.slice(0, 240) : String(err));
  }
  if (!rejected) throw new Error("CRITICAL: over-limit transfer succeeded");
  const after = await agentClient.accessKey.getRemainingLimit({ account: root.address, accessKey: agent, token: PATH_USD_ADDRESS });
  if (after.remaining !== usd) throw new Error("Budget changed after rejected transfer");
  console.log("PASS: actual Moderato transaction succeeded, over-limit attempt rejected, remaining 1 pathUSD");
}
main().catch(err => { console.error("FAIL:", err instanceof Error ? err.message : err); process.exitCode = 1; });
