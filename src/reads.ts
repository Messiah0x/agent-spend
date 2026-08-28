// Live chain reads for the dashboard. Budgets are never cached: the
// AccountKeychain precompile is the source of truth for remaining limits.

import {
  createPublicClient,
  http,
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  type Address,
  type PublicClient,
} from "viem";
import { ACCOUNT_KEYCHAIN_ADDRESS, keychainReadsAbi } from "./chain.js";
import type { Config } from "./config.js";

export interface RemainingBudget {
  token: Address;
  symbol: string;
  remaining: bigint;
  /** 0 for one-time limits; period end timestamp for periodic limits. */
  periodEnd: number;
}

export interface BudgetsResult {
  budgets: RemainingBudget[];
  /**
   * True when any read failed at the RPC/transport level, so `budgets` may be
   * incomplete. A contract-level revert/empty return (no limit configured) is
   * not a failure and never sets this.
   */
  unavailable: boolean;
}

/** Revert or empty return data: the chain answered, there is just no limit. */
function isContractLevel(err: unknown): boolean {
  return (
    err instanceof BaseError &&
    err.walk(
      (e) =>
        e instanceof ContractFunctionRevertedError ||
        e instanceof ContractFunctionZeroDataError,
    ) !== null
  );
}

export function createReader(config: Config) {
  const client: PublicClient = createPublicClient({ transport: http(config.rpcUrl) });

  return {
    /** Remaining budget for one agent key across all configured tokens. */
    async remainingBudgets(account: Address, keyId: Address): Promise<BudgetsResult> {
      let unavailable = false;
      const results = await Promise.all(
        config.tokens.map(async (token) => {
          try {
            const [remaining, periodEnd] = await client.readContract({
              address: ACCOUNT_KEYCHAIN_ADDRESS,
              abi: keychainReadsAbi,
              functionName: "getRemainingLimitWithPeriod",
              args: [account, keyId, token.address],
            });
            return {
              token: token.address,
              symbol: token.symbol,
              remaining,
              periodEnd: Number(periodEnd),
            };
          } catch (err) {
            if (!isContractLevel(err)) unavailable = true;
            return null;
          }
        }),
      );
      return { budgets: results.filter((r): r is RemainingBudget => r !== null), unavailable };
    },
  };
}

export type Reader = ReturnType<typeof createReader>;
