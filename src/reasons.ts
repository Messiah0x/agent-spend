// Reasons ledger: the human-readable "why" behind every agent payment.
//
// A TIP-20 memo is 32 bytes — a reference, not prose. The agent builds a
// reason record, hashes its canonical JSON with keccak256, and pays with
// `transferWithMemo` carrying that hash. Agent Spend stores the full record
// keyed by the hash. The link is verifiable in both directions: anyone can
// re-hash the record and compare it to the on-chain memo, and Agent Spend
// checks that the payment the chain recorded (payer, key, token, recipient,
// amount) is the payment the record describes.
//
// Records are submitted signed by the agent's access key (EIP-191 over the
// memo), so only a key the watched account actually authorized can attach
// reasons in its own name.

import { getAddress, isAddress, isHex, keccak256, recoverMessageAddress, toHex, type Address, type Hex } from "viem";

export const REASON_MAX_CHARS = 500;
const CONTEXT_MAX_CHARS = 200;

/** Optional structured context, e.g. from an MPP 402 challenge. */
export interface ReasonContext {
  /** MPP realm / service name. */
  realm?: string;
  /** MPP challenge `description`. */
  description?: string;
  /** MPP challenge `externalId` (invoice / order id). */
  externalId?: string;
}

export interface ReasonRecord {
  v: 1;
  /** Root account paying (lowercase). */
  account: string;
  /** Access key id making the payment (lowercase). */
  keyId: string;
  /** TIP-20 token (lowercase). */
  token: string;
  /** Recipient (lowercase). */
  to: string;
  /** Amount in token base units, decimal string. */
  amount: string;
  /** Why the agent is paying. Plain text. */
  reason: string;
  context?: ReasonContext;
  /** 16 random bytes (hex) so identical payments get distinct memos. */
  nonce: string;
}

/** JSON with object keys sorted recursively: a stable byte representation to hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** The bytes32 memo committing to a record. */
export function reasonMemo(record: ReasonRecord): Hex {
  return keccak256(toHex(canonicalJson(record)));
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** Build a well-formed record (addresses normalized, fresh nonce). */
export function buildReasonRecord(p: {
  account: Address;
  keyId: Address;
  token: Address;
  to: Address;
  amount: bigint;
  reason: string;
  context?: ReasonContext;
  nonce?: string;
}): ReasonRecord {
  const record: ReasonRecord = {
    v: 1,
    account: p.account.toLowerCase(),
    keyId: p.keyId.toLowerCase(),
    token: p.token.toLowerCase(),
    to: p.to.toLowerCase(),
    amount: p.amount.toString(),
    reason: p.reason.trim(),
    nonce: p.nonce ?? randomNonce(),
  };
  if (p.context && Object.values(p.context).some((v) => v)) record.context = p.context;
  const err = validateReasonRecord(record);
  if (err) throw new Error(`invalid reason record: ${err}`);
  return record;
}

/**
 * Strict validation of an untrusted record. Returns an error message, or
 * null when valid. Unknown fields are rejected so the hashed bytes contain
 * exactly what the dashboard can display.
 */
export function validateReasonRecord(r: unknown): string | null {
  if (!r || typeof r !== "object" || Array.isArray(r)) return "record must be an object";
  const rec = r as Record<string, unknown>;
  const allowed = new Set(["v", "account", "keyId", "token", "to", "amount", "reason", "context", "nonce"]);
  for (const k of Object.keys(rec)) if (!allowed.has(k)) return `unknown field: ${k}`;
  if (rec.v !== 1) return "v must be 1";
  for (const f of ["account", "keyId", "token", "to"] as const) {
    const v = rec[f];
    if (typeof v !== "string" || !isAddress(v, { strict: false }) || v !== v.toLowerCase()) {
      return `${f} must be a lowercase address`;
    }
  }
  if (typeof rec.amount !== "string" || !/^(0|[1-9]\d{0,77})$/.test(rec.amount)) {
    return "amount must be a base-unit decimal string";
  }
  if (typeof rec.reason !== "string" || rec.reason.trim().length === 0) return "reason is required";
  if (rec.reason.length > REASON_MAX_CHARS) return `reason exceeds ${REASON_MAX_CHARS} characters`;
  if (rec.reason !== rec.reason.trim()) return "reason must be trimmed";
  if (typeof rec.nonce !== "string" || !isHex(rec.nonce) || rec.nonce.length !== 34) {
    return "nonce must be 16 bytes of hex";
  }
  if (rec.context !== undefined) {
    const ctx = rec.context;
    if (!ctx || typeof ctx !== "object" || Array.isArray(ctx)) return "context must be an object";
    for (const [k, v] of Object.entries(ctx)) {
      if (!["realm", "description", "externalId"].includes(k)) return `unknown context field: ${k}`;
      if (typeof v !== "string" || v.length > CONTEXT_MAX_CHARS) {
        return `context.${k} must be a string of at most ${CONTEXT_MAX_CHARS} characters`;
      }
    }
  }
  return null;
}

/** Recover the signer of an agent's signature over `message` (EIP-191). */
export async function recoverSigner(message: Hex, signature: unknown): Promise<Address | null> {
  if (typeof signature !== "string" || !isHex(signature) || signature.length !== 132) return null;
  try {
    return getAddress(await recoverMessageAddress({ message: { raw: message }, signature }));
  } catch {
    return null;
  }
}

/** How a stored reason relates to the on-chain payment carrying its memo. */
export type ReasonVerdict = "verified" | "mismatch";

/** Compare a record with the payment the chain actually recorded. */
export function verifyAgainstPayment(
  record: ReasonRecord,
  payment: { account: string; key_id: string; token: string; to_addr: string | null; amount: string },
): { verdict: ReasonVerdict; problems: string[] } {
  const problems: string[] = [];
  if (record.account !== payment.account) problems.push("paying account differs");
  if (record.keyId !== payment.key_id) problems.push("paid by a different agent key");
  if (record.token !== payment.token) problems.push("token differs");
  if (record.to !== payment.to_addr) problems.push("recipient differs");
  if (record.amount !== payment.amount) problems.push("amount differs");
  return { verdict: problems.length ? "mismatch" : "verified", problems };
}
