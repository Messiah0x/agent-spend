// Approval workflow: turns Tempo's hard stop into a request.
//
// An agent that can't cover a payment (limit reached) submits a signed
// request: how much more it needs, for what, and why. The owner reviews it on
// the dashboard. Approving executes a real AccountKeychain transaction
// (updateSpendingLimit) through the operator key — the approval is on-chain
// state, not a flag here, so a compromised Agent Spend server still can't
// move money beyond what the chain allows.

import { isAddress, isHex, keccak256, toHex, type Address, type Hex } from "viem";
import { canonicalJson, REASON_MAX_CHARS } from "./reasons.js";

/** Pending requests older than this are shown as expired and can't be approved. */
export const APPROVAL_TTL_SECONDS = 7 * 24 * 3600;
/** Max simultaneously pending requests per key (spam bound). */
export const MAX_PENDING_PER_KEY = 20;

export interface ApprovalRequest {
  v: 1;
  type: "limit_increase";
  account: string;
  keyId: string;
  token: string;
  /** Additional budget needed, base units. */
  amount: string;
  /** Intended recipient, if known. */
  to?: string;
  reason: string;
  nonce: string;
}

export function approvalId(req: ApprovalRequest): Hex {
  return keccak256(toHex(canonicalJson(req)));
}

export function buildApprovalRequest(p: {
  account: Address;
  keyId: Address;
  token: Address;
  amount: bigint;
  to?: Address;
  reason: string;
  nonce?: string;
}): ApprovalRequest {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const req: ApprovalRequest = {
    v: 1,
    type: "limit_increase",
    account: p.account.toLowerCase(),
    keyId: p.keyId.toLowerCase(),
    token: p.token.toLowerCase(),
    amount: p.amount.toString(),
    reason: p.reason.trim(),
    nonce: p.nonce ?? toHex(bytes),
  };
  if (p.to) req.to = p.to.toLowerCase();
  const err = validateApprovalRequest(req);
  if (err) throw new Error(`invalid approval request: ${err}`);
  return req;
}

export function validateApprovalRequest(r: unknown): string | null {
  if (!r || typeof r !== "object" || Array.isArray(r)) return "request must be an object";
  const req = r as Record<string, unknown>;
  const allowed = new Set(["v", "type", "account", "keyId", "token", "amount", "to", "reason", "nonce"]);
  for (const k of Object.keys(req)) if (!allowed.has(k)) return `unknown field: ${k}`;
  if (req.v !== 1) return "v must be 1";
  if (req.type !== "limit_increase") return "type must be limit_increase";
  for (const f of ["account", "keyId", "token"] as const) {
    const v = req[f];
    if (typeof v !== "string" || !isAddress(v, { strict: false }) || v !== v.toLowerCase()) {
      return `${f} must be a lowercase address`;
    }
  }
  if (req.to !== undefined) {
    if (typeof req.to !== "string" || !isAddress(req.to, { strict: false }) || req.to !== req.to.toLowerCase()) {
      return "to must be a lowercase address";
    }
  }
  if (typeof req.amount !== "string" || !/^[1-9]\d{0,77}$/.test(req.amount)) {
    return "amount must be a positive base-unit decimal string";
  }
  if (typeof req.reason !== "string" || !req.reason.trim()) return "reason is required";
  if (req.reason.length > REASON_MAX_CHARS) return `reason exceeds ${REASON_MAX_CHARS} characters`;
  if (req.reason !== req.reason.trim()) return "reason must be trimmed";
  if (typeof req.nonce !== "string" || !isHex(req.nonce) || req.nonce.length !== 34) {
    return "nonce must be 16 bytes of hex";
  }
  return null;
}

export function isExpired(createdTime: number, now = Math.floor(Date.now() / 1000)): boolean {
  return now - createdTime > APPROVAL_TTL_SECONDS;
}
