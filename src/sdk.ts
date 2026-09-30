// Agent SDK: what an AI agent embeds to spend through Agent Spend.
//
//   const agent = createAgent({ baseUrl, account, privateKey });
//   await agent.pay({ to, amount: 12_500_000n, reason: "LLM credits, batch #4821" });
//
// `pay` pre-checks the live on-chain budget (fail fast instead of an on-chain
// revert), registers a signed reason record with Agent Spend, then pays with
// `transferWithMemo` carrying the record's hash — so the payment is
// explainable on the dashboard and verifiable by anyone.
//
// The agent holds only its own access key. Tempo enforces the budget; the SDK
// never needs, and never sees, the root key.

import { createClient, http, publicActions, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tempo, tempoModerato } from "viem/chains";
import { Account as TempoAccount, tempoActions } from "viem/tempo";
import { MODERATO_CHAIN_ID, MODERATO_RPC_URL, PATH_USD_ADDRESS } from "./chain.js";
import { approvalId, buildApprovalRequest } from "./approvals.js";
import { buildReasonRecord, reasonMemo, type ReasonContext, type ReasonRecord } from "./reasons.js";

/** Moves the funds. Swappable so the same agent code runs on Tempo or the local devnet. */
export interface Payer {
  transfer(p: { token: Address; to: Address; amount: bigint; memo: Hex }): Promise<{ txHash: Hex }>;
}

/** Real Tempo payer: signs with the access key through the account's keychain. */
export function tempoPayer(opts: { account: Address; privateKey: Hex; rpcUrl?: string; chainId?: number }): Payer {
  const chain = (opts.chainId ?? MODERATO_CHAIN_ID) === tempo.id ? tempo : tempoModerato;
  const accessKey = TempoAccount.fromSecp256k1(opts.privateKey, { access: opts.account });
  const client = createClient({
    account: accessKey,
    chain,
    transport: http(opts.rpcUrl ?? MODERATO_RPC_URL),
  })
    .extend(publicActions)
    .extend(tempoActions());
  return {
    async transfer({ token, to, amount, memo }) {
      const res = await client.token.transferSync({ token, to, amount, memo });
      return { txHash: res.receipt.transactionHash };
    },
  };
}

/** Local devnet payer (scripts/devnet.ts) — for demos and tests only. */
export function devnetPayer(opts: { rpcUrl: string; account: Address; keyId: Address; fee?: bigint }): Payer {
  return {
    async transfer({ token, to, amount, memo }) {
      const res = await fetch(opts.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "dev_pay",
          params: [
            {
              account: opts.account,
              keyId: opts.keyId,
              token,
              to,
              amount: amount.toString(),
              memo,
              fee: opts.fee?.toString(),
            },
          ],
        }),
      });
      const json = (await res.json()) as { result?: { txHash: Hex }; error?: { message: string } };
      if (json.error) throw new Error(json.error.message);
      return { txHash: json.result!.txHash };
    },
  };
}

export class AgentSpendError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AgentSpendError";
  }
}

/** Thrown before any transaction is sent when the payment would exceed the key's remaining budget. */
export class BudgetExceededError extends AgentSpendError {
  constructor(
    readonly requested: bigint,
    readonly remaining: bigint,
  ) {
    super(`payment of ${requested} exceeds remaining budget ${remaining}; request approval to raise the limit`);
    this.name = "BudgetExceededError";
  }
}

export interface AgentOptions {
  /** Agent Spend instance, e.g. https://agent-spend.example.com */
  baseUrl: string;
  /** The root Tempo account this agent spends from. */
  account: Address;
  /** The agent's secp256k1 access-key private key. */
  privateKey: Hex;
  /** Default TIP-20 token (pathUSD). */
  token?: Address;
  /** How payments are sent; defaults to a real Tempo payer. */
  payer?: Payer;
  rpcUrl?: string;
  chainId?: number;
  /** Injectable fetch (tests, custom agents). */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface ApprovalStatus {
  id: Hex;
  status: "pending" | "approved" | "denied" | "failed" | "expired";
  amount: string;
  newLimit: string | null;
  txHash: string | null;
  note: string | null;
}

export interface Budget {
  token: string;
  symbol: string;
  remaining: bigint;
  periodEnd: number;
}

export function createAgent(opts: AgentOptions) {
  const signer = privateKeyToAccount(opts.privateKey);
  const keyId = signer.address;
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  const doFetch = opts.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const defaultToken = opts.token ?? PATH_USD_ADDRESS;
  const payer =
    opts.payer ?? tempoPayer({ account: opts.account, privateKey: opts.privateKey, rpcUrl: opts.rpcUrl, chainId: opts.chainId });

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await doFetch(`${baseUrl}/api/v1${path}`, init);
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new AgentSpendError(body.error ?? `HTTP ${res.status}`, res.status);
    return body;
  }

  const agent = {
    keyId,
    account: opts.account,

    /** Live remaining budget per token, as enforced on-chain. */
    async budgets(): Promise<Budget[]> {
      const res = await call<{ budgets: { token: string; symbol: string; remaining: string; periodEnd: number }[] }>(
        `/agents/${opts.account}/${keyId}`,
      );
      return res.budgets.map((b) => ({ ...b, remaining: BigInt(b.remaining) }));
    },

    /** Sign and register a reason record; returns the memo to pay with. */
    async registerReason(p: {
      to: Address;
      amount: bigint;
      reason: string;
      context?: ReasonContext;
      token?: Address;
    }): Promise<{ memo: Hex; record: ReasonRecord }> {
      const record = buildReasonRecord({
        account: opts.account,
        keyId,
        token: p.token ?? defaultToken,
        to: p.to,
        amount: p.amount,
        reason: p.reason,
        context: p.context,
      });
      const memo = reasonMemo(record);
      const signature = await signer.signMessage({ message: { raw: memo } });
      await call("/reasons", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ record, signature }),
      });
      return { memo, record };
    },

    /**
     * Pay with a reason. Throws BudgetExceededError (before sending anything)
     * if the live budget can't cover it.
     */
    async pay(p: {
      to: Address;
      amount: bigint;
      reason: string;
      context?: ReasonContext;
      token?: Address;
      /** Skip the budget pre-check (the chain still enforces the limit). */
      skipBudgetCheck?: boolean;
    }): Promise<{ txHash: Hex; memo: Hex }> {
      const token = p.token ?? defaultToken;
      if (p.amount <= 0n) throw new AgentSpendError("amount must be positive");
      if (!p.skipBudgetCheck) {
        const budget = (await agent.budgets()).find((b) => b.token.toLowerCase() === token.toLowerCase());
        if (budget && budget.remaining < p.amount) throw new BudgetExceededError(p.amount, budget.remaining);
      }
      const { memo } = await agent.registerReason({ ...p, token });
      const { txHash } = await payer.transfer({ token, to: p.to, amount: p.amount, memo });
      return { txHash, memo };
    },

    /**
     * Ask the owner for more budget (after a BudgetExceededError, typically).
     * Approval raises the key's on-chain limit; poll with `approval()` or
     * `waitForApproval()`.
     */
    async requestApproval(p: { amount: bigint; reason: string; to?: Address; token?: Address }): Promise<ApprovalStatus> {
      const request = buildApprovalRequest({
        account: opts.account,
        keyId,
        token: p.token ?? defaultToken,
        amount: p.amount,
        to: p.to,
        reason: p.reason,
      });
      const signature = await signer.signMessage({ message: { raw: approvalId(request) } });
      return call<ApprovalStatus>("/approvals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request, signature }),
      });
    },

    async approval(id: Hex): Promise<ApprovalStatus> {
      return call<ApprovalStatus>(`/approvals/${id}`);
    },

    /** Poll until the request is decided (or `timeoutMs` passes — then returns the pending status). */
    async waitForApproval(id: Hex, o: { timeoutMs?: number; pollMs?: number } = {}): Promise<ApprovalStatus> {
      const deadline = Date.now() + (o.timeoutMs ?? 10 * 60_000);
      for (;;) {
        const s = await agent.approval(id);
        if (s.status !== "pending" || Date.now() >= deadline) return s;
        await new Promise((r) => setTimeout(r, o.pollMs ?? 3_000));
      }
    },
  };
  return agent;
}

export type Agent = ReturnType<typeof createAgent>;
