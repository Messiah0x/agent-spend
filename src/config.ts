import { getAddress, isAddress, type Address } from "viem";
import {
  MODERATO_CHAIN_ID,
  MODERATO_RPC_URL,
  PATH_USD_ADDRESS,
} from "./chain.js";

export interface TokenConfig {
  address: Address;
  symbol: string;
}

export interface Config {
  rpcUrl: string;
  chainId: number;
  /** Tempo accounts whose agent keys and payments we watch. */
  watchedAccounts: Address[];
  tokens: TokenConfig[];
  startBlock: bigint;
  confirmations: bigint;
  pollIntervalMs: number;
  dbPath: string;
  port: number;
  /** Optional block-explorer base URL; tx links are omitted when unset. */
  explorerUrl?: string;
  /**
   * Basic Auth credentials guarding write routes (currently: agent naming).
   * Undefined unless both are set — writes fail closed (503) until they are.
   */
  adminUser?: string;
  adminPassword?: string;
  /** Public origin of the dashboard (e.g. https://agent-spend.up.railway.app), used for CSRF origin checks. */
  publicUrl?: string;
  /** Trust X-Forwarded-For for client IPs (set when behind a reverse proxy such as Railway). */
  trustProxy: boolean;
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: string): number {
  const raw = env[name] ?? fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer, got: ${raw}`);
  return n;
}

function bigEnv(env: NodeJS.ProcessEnv, name: string, fallback: string): bigint {
  const raw = env[name] ?? fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a non-negative integer, got: ${raw}`);
  return BigInt(raw);
}

function parseAccounts(raw: string): Address[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      if (!isAddress(s)) throw new Error(`Invalid address in WATCHED_ACCOUNTS: ${s}`);
      return getAddress(s);
    });
}

/** TOKENS is a comma-separated list of `address:SYMBOL` pairs. */
function parseTokens(raw: string): TokenConfig[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [addr, symbol] = pair.split(":");
      if (!addr || !isAddress(addr)) throw new Error(`Invalid token in TOKENS: ${pair}`);
      return { address: getAddress(addr), symbol: symbol?.trim() || "TOKEN" };
    });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const accounts = env.WATCHED_ACCOUNTS;
  if (!accounts) {
    throw new Error(
      "WATCHED_ACCOUNTS is required (comma-separated Tempo account addresses to watch)",
    );
  }
  return {
    rpcUrl: env.TEMPO_RPC_URL ?? MODERATO_RPC_URL,
    chainId: intEnv(env, "TEMPO_CHAIN_ID", String(MODERATO_CHAIN_ID)),
    watchedAccounts: parseAccounts(accounts),
    tokens: parseTokens(env.TOKENS ?? `${PATH_USD_ADDRESS}:pathUSD`),
    startBlock: bigEnv(env, "START_BLOCK", "0"),
    confirmations: bigEnv(env, "CONFIRMATIONS", "2"),
    pollIntervalMs: intEnv(env, "POLL_INTERVAL_MS", "2000"),
    dbPath: env.DB_PATH ?? "./data/agent-spend.db",
    port: intEnv(env, "PORT", "3000"),
    explorerUrl: env.EXPLORER_URL || undefined,
    adminUser: env.ADMIN_USER || undefined,
    adminPassword: env.ADMIN_PASSWORD || undefined,
    publicUrl: env.PUBLIC_URL || undefined,
    trustProxy: env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true",
  };
}
