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
    chainId: Number(env.TEMPO_CHAIN_ID ?? MODERATO_CHAIN_ID),
    watchedAccounts: parseAccounts(accounts),
    tokens: parseTokens(env.TOKENS ?? `${PATH_USD_ADDRESS}:pathUSD`),
    startBlock: BigInt(env.START_BLOCK ?? "0"),
    confirmations: BigInt(env.CONFIRMATIONS ?? "2"),
    pollIntervalMs: Number(env.POLL_INTERVAL_MS ?? "2000"),
    dbPath: env.DB_PATH ?? "./data/agent-spend.db",
    port: Number(env.PORT ?? "3000"),
    explorerUrl: env.EXPLORER_URL || undefined,
  };
}
