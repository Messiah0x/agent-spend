// Operator writes: the on-chain half of "control". Every control action in
// the dashboard (revoke a key, set a limit, authorize a new agent, approve an
// escalation) is a real AccountKeychain transaction — never a flag in our
// database. Tempo stays the enforcement layer; Agent Spend only submits.
//
// The operator key is optional. Without it, the dashboard is read-only for
// on-chain state and approvals record a decision the owner must execute
// themselves. Modes:
//   admin  — an admin access key of the account (TIP-1049), signing through
//            the keychain. Recommended: the root key never touches a server.
//   root   — the account's root key. Testnet/demo convenience only.
//   devnet — the local fixture's dev_* methods. Local demos and tests only.

import { createClient, http, publicActions, type Address, type Hex } from "viem";
import { tempo, tempoModerato } from "viem/chains";
import { Account as TempoAccount, tempoActions } from "viem/tempo";
import type { Config } from "./config.js";

export type OperatorMode = "admin" | "root" | "devnet";

export interface AuthorizeParams {
  keyId: Address;
  token: Address;
  /** Base units. */
  limit: bigint;
  /** Seconds; 0 = one-time (non-resetting) limit. */
  period: number;
  /** Unix seconds; 0 = never expires. */
  expiry: number;
}

export interface ChainWriter {
  mode: OperatorMode;
  /** The watched account this operator controls. */
  account: Address;
  revoke(keyId: Address): Promise<Hex>;
  setLimit(keyId: Address, token: Address, limit: bigint): Promise<Hex>;
  authorize(p: AuthorizeParams): Promise<Hex>;
}

export function createWriter(config: Config): ChainWriter | null {
  const op = config.operator;
  if (!op) return null;
  if (op.mode === "devnet") return devnetWriter(config.rpcUrl, op.account);
  return tempoWriter(config, op.account, op.privateKey!, op.mode);
}

function tempoWriter(config: Config, account: Address, privateKey: Hex, mode: "admin" | "root"): ChainWriter {
  const chain = config.chainId === tempo.id ? tempo : tempoModerato;
  const signer =
    mode === "root" ? TempoAccount.fromSecp256k1(privateKey) : TempoAccount.fromSecp256k1(privateKey, { access: account });
  if (mode === "root" && signer.address.toLowerCase() !== account.toLowerCase()) {
    throw new Error("OPERATOR_PRIVATE_KEY (root mode) does not belong to OPERATOR_ACCOUNT");
  }
  const client = createClient({ account: signer, chain, transport: http(config.rpcUrl) })
    .extend(publicActions)
    .extend(tempoActions());
  return {
    mode,
    account,
    async revoke(keyId) {
      const res = await client.accessKey.revokeSync({ accessKey: keyId });
      return res.receipt.transactionHash;
    },
    async setLimit(keyId, token, limit) {
      const res = await client.accessKey.updateLimitSync({ accessKey: keyId, token, limit });
      return res.receipt.transactionHash;
    },
    async authorize(p) {
      const res = await client.accessKey.authorizeSync({
        accessKey: { accessKeyAddress: p.keyId, keyType: "secp256k1" },
        limits: [{ token: p.token, limit: p.limit, ...(p.period > 0 ? { period: p.period } : {}) }],
        ...(p.expiry > 0 ? { expiry: p.expiry } : {}),
      });
      return res.receipt.transactionHash;
    },
  };
}

function devnetWriter(rpcUrl: string, account: Address): ChainWriter {
  async function rpc(method: string, params: Record<string, unknown>): Promise<Hex> {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [params] }),
    });
    const json = (await res.json()) as { result?: { txHash: Hex }; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    return json.result!.txHash;
  }
  return {
    mode: "devnet",
    account,
    revoke: (keyId) => rpc("dev_revokeKey", { account, keyId }),
    setLimit: (keyId, token, limit) => rpc("dev_updateLimit", { account, keyId, token, newLimit: limit.toString() }),
    authorize: (p) =>
      rpc("dev_authorizeKey", {
        account,
        keyId: p.keyId,
        token: p.token,
        limit: p.limit.toString(),
        period: p.period,
        expiry: p.expiry,
      }),
  };
}

/** Short, secret-free message for showing a failed on-chain write to the operator. */
export function describeWriteError(err: unknown): string {
  const msg = err instanceof Error ? ((err as { shortMessage?: string }).shortMessage ?? err.message) : String(err);
  // viem errors can embed the RPC URL (which may carry an API key) — strip URLs.
  return msg.replace(/https?:\/\/\S+/g, "[rpc]").split("\n")[0]!.slice(0, 300);
}
