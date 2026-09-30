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
  /**
   * Optional operator key that executes control actions on-chain (revoke,
   * set limit, authorize, approve). Undefined → on-chain controls disabled.
   */
  operator?: {
    mode: "admin" | "root" | "devnet";
    account: Address;
    /** Absent in devnet mode. Never logged or rendered. */
    privateKey?: `0x${string}`;
  };
  /** Warn when an agent's remaining budget drops below this % of its limit. */
  alertThresholdPct: number;
  /** Optional webhook (Slack-compatible `{ text }` JSON) for approvals and budget alerts. */
  webhookUrl?: string;
}

function parseOperator(env: NodeJS.ProcessEnv, watched: Address[], rpcUrl: string): Config["operator"] {
  const mode = envValue(env, "OPERATOR_MODE");
  if (!mode) return undefined;
  if (mode !== "admin" && mode !== "root" && mode !== "devnet") {
    throw new Error(`OPERATOR_MODE must be admin, root, or devnet, got: ${mode}`);
  }
  const rawAccount = envValue(env, "OPERATOR_ACCOUNT") ?? (watched.length === 1 ? watched[0] : undefined);
  if (!rawAccount || !isAddress(rawAccount)) {
    throw new Error("OPERATOR_ACCOUNT must be set to one of WATCHED_ACCOUNTS");
  }
  const account = getAddress(rawAccount);
  if (!watched.some((a) => a.toLowerCase() === account.toLowerCase())) {
    throw new Error("OPERATOR_ACCOUNT must be one of WATCHED_ACCOUNTS");
  }
  if (mode === "devnet") {
    if (rpcUrl === MODERATO_RPC_URL) throw new Error("OPERATOR_MODE=devnet cannot be used against a real Tempo RPC");
    return { mode, account };
  }
  const pk = env.OPERATOR_PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error(`OPERATOR_PRIVATE_KEY (32-byte hex) is required for OPERATOR_MODE=${mode}`);
  }
  return { mode, account, privateKey: pk as `0x${string}` };
}

/** An env var's value, treating empty/whitespace-only as unset (hosting dashboards often leave blanks). */
function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const v = env[name]?.trim();
  return v ? v : undefined;
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: string): number {
  const raw = envValue(env, name) ?? fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer, got: ${raw}`);
  return n;
}

function bigEnv(env: NodeJS.ProcessEnv, name: string, fallback: string): bigint {
  const raw = envValue(env, name) ?? fallback;
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

function parseWebhook(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("WEBHOOK_URL must be a valid URL");
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("WEBHOOK_URL must use https");
  }
  return url.toString();
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const accounts = env.WATCHED_ACCOUNTS;
  if (!accounts) {
    throw new Error(
      "WATCHED_ACCOUNTS is required (comma-separated Tempo account addresses to watch)",
    );
  }
  const config: Config = {
    rpcUrl: envValue(env, "TEMPO_RPC_URL") ?? MODERATO_RPC_URL,
    chainId: intEnv(env, "TEMPO_CHAIN_ID", String(MODERATO_CHAIN_ID)),
    watchedAccounts: parseAccounts(accounts),
    tokens: parseTokens(envValue(env, "TOKENS") ?? `${PATH_USD_ADDRESS}:pathUSD`),
    startBlock: bigEnv(env, "START_BLOCK", "0"),
    confirmations: bigEnv(env, "CONFIRMATIONS", "2"),
    pollIntervalMs: intEnv(env, "POLL_INTERVAL_MS", "2000"),
    dbPath: envValue(env, "DB_PATH") ?? "./data/agent-spend.db",
    port: intEnv(env, "PORT", "3000"),
    explorerUrl: env.EXPLORER_URL || undefined,
    adminUser: env.ADMIN_USER || undefined,
    adminPassword: env.ADMIN_PASSWORD || undefined,
    publicUrl: env.PUBLIC_URL || undefined,
    trustProxy: env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true",
    operator: undefined,
    alertThresholdPct: Math.min(intEnv(env, "ALERT_THRESHOLD_PCT", "20"), 100),
    webhookUrl: parseWebhook(env.WEBHOOK_URL),
  };
  config.operator = parseOperator(env, config.watchedAccounts, config.rpcUrl);
  return config;
}
