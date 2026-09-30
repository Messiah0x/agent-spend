// JSON API (/api/v1). Reads are public, like the dashboard. Writes come from
// agents and must be signed by the agent's own access key — there is no
// shared API secret to leak, and a key can only act in its own name.

import { Hono, type Context } from "hono";
import { isAddress, isHex, type Address, type Hex } from "viem";
import type { Config } from "./config.js";
import type { Db, PaymentRow, StoredReason } from "./db.js";
import { keyStatus } from "./keys.js";
import type { Reader } from "./reads.js";
import {
  reasonMemo,
  recoverSigner,
  validateReasonRecord,
  verifyAgainstPayment,
  type ReasonRecord,
  type ReasonVerdict,
} from "./reasons.js";

/** Max reason records one key may submit per rolling 24h (spam bound). */
export const REASONS_PER_KEY_PER_DAY = 1_000;

export interface EnrichedPayment extends PaymentRow {
  reason: StoredReason | null;
  verdict: ReasonVerdict | null;
  problems: string[];
}

/** Attach each payment's reason record (by memo) and check it against the chain. */
export function enrichPayments(db: Db, payments: PaymentRow[]): EnrichedPayment[] {
  const reasons = db.reasonsFor(payments.map((p) => p.memo));
  return payments.map((p) => {
    const reason = p.memo ? (reasons.get(p.memo.toLowerCase()) ?? null) : null;
    if (!reason || p.kind !== "payment") return { ...p, reason: null, verdict: null, problems: [] };
    const { verdict, problems } = verifyAgainstPayment(reason.record, p);
    return { ...p, reason, verdict, problems };
  });
}

/**
 * Authenticate an agent write: the signature must recover to `keyId`, and
 * that key must be an indexed, currently active key of a watched account.
 */
export async function authenticateAgent(
  config: Config,
  db: Db,
  p: { account: string; keyId: string; message: Hex; signature: unknown },
): Promise<{ ok: true } | { ok: false; status: 401 | 403; error: string }> {
  const signer = await recoverSigner(p.message, p.signature);
  if (!signer || signer.toLowerCase() !== p.keyId.toLowerCase()) {
    return { ok: false, status: 401, error: "signature does not match keyId" };
  }
  if (!config.watchedAccounts.some((a) => a.toLowerCase() === p.account.toLowerCase())) {
    return { ok: false, status: 403, error: "account is not watched by this Agent Spend instance" };
  }
  const key = db.getKey(p.account, p.keyId);
  if (!key) {
    return {
      ok: false,
      status: 403,
      error: "access key not (yet) indexed for this account — retry after the authorization confirms",
    };
  }
  const status = keyStatus(key);
  if (status !== "active") return { ok: false, status: 403, error: `access key is ${status}` };
  return { ok: true };
}

const bigintJson = (v: unknown) =>
  JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

async function readJson(c: Context): Promise<unknown> {
  if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "content-type must be application/json");
  }
  try {
    return await c.req.json();
  } catch {
    throw new ApiError(400, "invalid JSON body");
  }
}

class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 415 | 429,
    message: string,
  ) {
    super(message);
  }
}

function paymentJson(p: EnrichedPayment, labels: Map<string, string>) {
  return {
    txHash: p.tx_hash,
    logIndex: p.log_index,
    blockNumber: p.block_number,
    time: p.block_time,
    kind: p.kind,
    account: p.account,
    keyId: p.key_id,
    agentName: labels.get(`${p.account}|${p.key_id}`) ?? null,
    token: p.token,
    amount: p.amount,
    remainingAfter: p.remaining,
    to: p.to_addr,
    memo: p.memo,
    reason: p.reason ? { text: p.reason.record.reason, context: p.reason.record.context ?? null } : null,
    reasonVerdict: p.verdict,
    reasonProblems: p.problems,
  };
}

export function createApi(config: Config, db: Db, reader: Reader) {
  const api = new Hono();

  api.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: err.message }, err.status);
    if ("getResponse" in err && typeof err.getResponse === "function") return err.getResponse();
    console.error("[api] unhandled error:", err);
    return c.json({ error: "internal error" }, 500);
  });
  api.notFound((c) => c.json({ error: "not found" }, 404));

  const addr = (c: Context, name: string): string => {
    const v = c.req.param(name);
    if (!v || !isAddress(v, { strict: false })) throw new ApiError(400, `${name} must be an address`);
    return v.toLowerCase();
  };

  async function agentJson(k: ReturnType<Db["listKeys"]>[number], labels: Map<string, string>, totals: Map<string, bigint>) {
    const status = keyStatus(k);
    const budgets =
      status === "active"
        ? await reader.remainingBudgets(k.account as Address, k.key_id as Address)
        : { budgets: [], unavailable: false };
    return {
      account: k.account,
      keyId: k.key_id,
      name: labels.get(`${k.account}|${k.key_id}`) ?? null,
      status,
      expiry: k.expiry,
      authorizedAt: k.authorized_time,
      revokedAt: k.revoked_time,
      spent: config.tokens.map((t) => ({
        token: t.address.toLowerCase(),
        symbol: t.symbol,
        amount: (totals.get(`${k.account}|${k.key_id}|${t.address.toLowerCase()}`) ?? 0n).toString(),
      })),
      budgets: budgets.budgets.map((b) => ({
        token: b.token.toLowerCase(),
        symbol: b.symbol,
        remaining: b.remaining.toString(),
        periodEnd: b.periodEnd,
      })),
      budgetsUnavailable: budgets.unavailable,
    };
  }

  // ── Reads ─────────────────────────────────────────────────────────────────
  api.get("/agents", async (c) => {
    const labels = db.listLabels();
    const totals = db.spendTotals();
    const agents = await Promise.all(db.listKeys().map((k) => agentJson(k, labels, totals)));
    return c.json({ agents });
  });

  api.get("/agents/:account/:keyId", async (c) => {
    const key = db.getKey(addr(c, "account"), addr(c, "keyId"));
    if (!key) throw new ApiError(404, "agent key not found");
    return c.json(bigintJson(await agentJson(key, db.listLabels(), db.spendTotals())));
  });

  api.get("/payments", (c) => {
    const account = c.req.query("account");
    const keyId = c.req.query("keyId");
    if (account && !isAddress(account, { strict: false })) throw new ApiError(400, "account must be an address");
    if (keyId && !isAddress(keyId, { strict: false })) throw new ApiError(400, "keyId must be an address");
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 100) || 100, 1), 500);
    const payments = enrichPayments(db, db.listPayments({ limit, account, keyId }));
    const labels = db.listLabels();
    return c.json({ payments: payments.map((p) => paymentJson(p, labels)) });
  });

  api.get("/reasons/:memo", (c) => {
    const memo = c.req.param("memo");
    if (!isHex(memo) || memo.length !== 66) throw new ApiError(400, "memo must be 32 bytes of hex");
    const stored = db.getReason(memo);
    if (!stored) throw new ApiError(404, "no reason recorded for this memo");
    const payment = enrichPayments(db, db.listPayments({ memo, limit: 10 })).find((p) => p.kind === "payment");
    return c.json({
      memo: stored.memo,
      record: stored.record,
      signature: stored.signature,
      recordedAt: stored.created_time,
      payment: payment ? paymentJson(payment, db.listLabels()) : null,
      status: payment ? payment.verdict : "pending",
    });
  });

  // ── Agent writes ──────────────────────────────────────────────────────────
  /**
   * Register a reason before paying. Body: `{ record, signature }` where
   * `signature` is the agent key's EIP-191 signature over the memo (the
   * keccak256 of the record's canonical JSON). Returns the memo to put in
   * `transferWithMemo`. Idempotent.
   */
  api.post("/reasons", async (c) => {
    const body = (await readJson(c)) as { record?: unknown; signature?: unknown };
    const problem = validateReasonRecord(body?.record);
    if (problem) throw new ApiError(400, problem);
    const record = body.record as ReasonRecord;
    if (!config.tokens.some((t) => t.address.toLowerCase() === record.token)) {
      throw new ApiError(400, "token is not tracked by this Agent Spend instance");
    }
    const memo = reasonMemo(record);
    const auth = await authenticateAgent(config, db, {
      account: record.account,
      keyId: record.keyId,
      message: memo,
      signature: body.signature,
    });
    if (!auth.ok) throw new ApiError(auth.status, auth.error);

    const since = Math.floor(Date.now() / 1000) - 86_400;
    if (db.reasonCountSince(record.account, record.keyId, since) >= REASONS_PER_KEY_PER_DAY) {
      throw new ApiError(429, "daily reason quota for this key exceeded");
    }
    const created = db.insertReason(memo, record, body.signature as string);
    return c.json({ memo, created }, created ? 201 : 200);
  });

  return api;
}
