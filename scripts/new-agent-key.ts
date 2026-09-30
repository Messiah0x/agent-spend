// Generate a fresh secp256k1 access key for a new agent, locally. The private
// key stays with the agent; give only the printed address to the operator
// (Keys → "Authorize a new agent"). Agent Spend never sees private keys.
//
//   npm run new-agent-key            # prints to stdout
//   npm run new-agent-key -- out.json  # writes a 0600 JSON file instead

import { writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const privateKey = generatePrivateKey();
const address = privateKeyToAccount(privateKey).address;
const out = process.argv[2];

if (out) {
  writeFileSync(out, JSON.stringify({ address, privateKey }, null, 2), { mode: 0o600, flag: "wx" });
  console.log(`agent key address: ${address}`);
  console.log(`private key written to ${out} (mode 0600) — keep it with the agent, never commit it`);
} else {
  console.log(`agent key address: ${address}   ← authorize this in Agent Spend`);
  console.log(`private key:       ${privateKey}   ← give this only to the agent (AGENT_PRIVATE_KEY)`);
}
