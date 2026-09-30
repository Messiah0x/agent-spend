import type { KeyRow } from "./db.js";

export type KeyStatus = "active" | "revoked" | "expired";

export function keyStatus(k: KeyRow, now = Math.floor(Date.now() / 1000)): KeyStatus {
  if (k.revoked_block !== null) return "revoked";
  if (k.expiry !== 0 && k.expiry < now) return "expired";
  return "active";
}
