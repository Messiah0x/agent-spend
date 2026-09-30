import { TIP20_DECIMALS } from "./chain.js";

/**
 * Format a TIP-20 base-unit amount (6 decimals) as a display string, truncated
 * to `decimals` places (2 by default; use more for tiny amounts like fees).
 */
export function formatAmount(baseUnits: bigint | string, decimals = 2): string {
  const v = typeof baseUnits === "string" ? BigInt(baseUnits) : baseUnits;
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const divisor = 10n ** BigInt(TIP20_DECIMALS);
  const whole = abs / divisor;
  const frac = abs % divisor;
  const wholeStr = whole.toLocaleString("en-US");
  const fracStr = frac.toString().padStart(TIP20_DECIMALS, "0").slice(0, decimals);
  return `${negative ? "-" : ""}${wholeStr}.${fracStr}`;
}

export function shortAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function shortHash(hash: string): string {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 10)}…`;
}

/** bytes32 memo → compact display form; treats zero memo as absent. */
export function shortMemo(memo: string | null): string | null {
  if (!memo) return null;
  if (/^0x0+$/.test(memo)) return null;
  return `${memo.slice(0, 10)}…`;
}

export function formatTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function relativeTime(unixSeconds: number, now = Date.now()): string {
  const diff = Math.max(0, Math.floor(now / 1000) - unixSeconds);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/** Amount with enough precision that a small non-zero value never renders as 0.00. */
export function formatSmallAmount(baseUnits: bigint | string): string {
  const v = typeof baseUnits === "string" ? BigInt(baseUnits) : baseUnits;
  const abs = v < 0n ? -v : v;
  return formatAmount(v, abs > 0n && abs < 10_000n ? 6 : abs < 1_000_000n ? 4 : 2);
}
