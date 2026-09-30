import {
  createPublicClient,
  http,
  decodeEventLog,
  encodeEventTopics,
  pad,
  type Address,
  type Log,
  type PublicClient,
} from "viem";
import { ACCOUNT_KEYCHAIN_ADDRESS, keychainEventsAbi, tip20EventsAbi } from "./chain.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";

const MAX_BLOCK_RANGE = 5_000n;
/** How far back to re-index when the last indexed block's hash changed. */
const REORG_REWIND = 64n;

function topic0(abi: typeof keychainEventsAbi | typeof tip20EventsAbi, eventName: string) {
  return encodeEventTopics({ abi: abi as any, eventName } as any)[0]!;
}

export function createIndexer(config: Config, db: Db) {
  const client: PublicClient = createPublicClient({ transport: http(config.rpcUrl) });
  const accountTopics = config.watchedAccounts.map((a) => pad(a.toLowerCase() as Address));
  const tokenAddresses = config.tokens.map((t) => t.address);

  const keychainTopic0 = [
    topic0(keychainEventsAbi, "KeyAuthorized"),
    topic0(keychainEventsAbi, "KeyRevoked"),
    topic0(keychainEventsAbi, "SpendingLimitUpdated"),
    topic0(keychainEventsAbi, "AccessKeySpend"),
  ];
  const tip20Topic0 = [
    topic0(tip20EventsAbi, "Transfer"),
    topic0(tip20EventsAbi, "TransferWithMemo"),
  ];

  // Small cross-range cache so consecutive polls don't refetch the same block.
  const blockTimeCache = new Map<bigint, number>();
  async function blockTime(blockNumber: bigint): Promise<number> {
    const cached = blockTimeCache.get(blockNumber);
    if (cached !== undefined) return cached;
    const block = await client.getBlock({ blockNumber });
    const t = Number(block.timestamp);
    blockTimeCache.set(blockNumber, t);
    if (blockTimeCache.size > 1024) {
      for (const k of blockTimeCache.keys()) {
        if (blockTimeCache.size <= 512) break;
        blockTimeCache.delete(k);
      }
    }
    return t;
  }

  function ingestKeychainLog(log: Log, time: number) {
    const decoded = decodeEventLog({
      abi: keychainEventsAbi,
      data: log.data,
      topics: log.topics,
    });
    const base = {
      tx_hash: log.transactionHash!,
      log_index: Number(log.logIndex!),
      block_number: Number(log.blockNumber!),
      block_time: time,
    };
    switch (decoded.eventName) {
      case "KeyAuthorized":
        db.insertKey({
          account: decoded.args.account.toLowerCase(),
          key_id: decoded.args.publicKey.toLowerCase(),
          signature_type: decoded.args.signatureType,
          expiry: Number(decoded.args.expiry),
          authorized_block: base.block_number,
          authorized_tx: base.tx_hash,
          authorized_time: time,
        });
        break;
      case "KeyRevoked":
        db.markKeyRevoked(
          decoded.args.account.toLowerCase(),
          decoded.args.publicKey.toLowerCase(),
          base.block_number,
          base.tx_hash,
          time,
        );
        break;
      case "SpendingLimitUpdated":
        db.insertLimitUpdate({
          ...base,
          account: decoded.args.account.toLowerCase(),
          key_id: decoded.args.publicKey.toLowerCase(),
          token: decoded.args.token.toLowerCase(),
          new_limit: decoded.args.newLimit.toString(),
        });
        break;
      case "AccessKeySpend":
        db.insertSpend({
          ...base,
          account: decoded.args.account.toLowerCase(),
          key_id: decoded.args.publicKey.toLowerCase(),
          token: decoded.args.token.toLowerCase(),
          amount: decoded.args.amount.toString(),
          remaining: decoded.args.remainingLimit.toString(),
        });
        break;
    }
  }

  function ingestTransferLog(log: Log, time: number) {
    const decoded = decodeEventLog({
      abi: tip20EventsAbi,
      data: log.data,
      topics: log.topics,
    });
    db.insertTransfer({
      tx_hash: log.transactionHash!,
      log_index: Number(log.logIndex!),
      block_number: Number(log.blockNumber!),
      block_time: time,
      from_addr: decoded.args.from.toLowerCase(),
      to_addr: decoded.args.to.toLowerCase(),
      token: log.address.toLowerCase(),
      amount: decoded.args.amount.toString(),
      memo: decoded.eventName === "TransferWithMemo" ? decoded.args.memo : null,
    });
  }

  /** Decode failures are logged and skipped so one bad log can't stall indexing. */
  function safely(kind: string, log: Log, fn: () => void) {
    try {
      fn();
    } catch (err) {
      console.warn(
        `[indexer] skipped undecodable ${kind} log ${log.transactionHash}:${log.logIndex}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  async function fetchRange(fromBlock: bigint, toBlock: bigint) {
    // Both filters constrain topic1 (account for keychain events, `from`
    // for TIP-20 transfers) to the watched accounts, server-side.
    const range = {
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
    } as const;
    const [keychainLogs, transferLogs] = await Promise.all([
      client.request({
        method: "eth_getLogs",
        params: [{ address: ACCOUNT_KEYCHAIN_ADDRESS, topics: [keychainTopic0, accountTopics], ...range }],
      }),
      client.request({
        method: "eth_getLogs",
        params: [{ address: tokenAddresses, topics: [tip20Topic0, accountTopics], ...range }],
      }),
    ]);
    const keychain = (keychainLogs as unknown[]).map(normalize);
    const transfers = (transferLogs as unknown[]).map(normalize);

    // Resolve every block timestamp for this range up front, into a map that
    // outlives cache eviction, so the DB write below can be fully synchronous.
    const times = new Map<bigint, number>();
    for (const log of [...keychain, ...transfers]) {
      const n = log.blockNumber!;
      if (!times.has(n)) times.set(n, await blockTime(n));
    }
    return { keychain, transfers, times };
  }

  /** Check the last indexed block is still canonical; rewind if it isn't. */
  async function detectReorg(): Promise<boolean> {
    const cursor = db.getCursor();
    const storedHash = db.getCursorHash();
    if (cursor === null || storedHash === null) return false;
    const block = await client.getBlock({ blockNumber: cursor }).catch(() => null);
    if (block && block.hash?.toLowerCase() === storedHash.toLowerCase()) return false;
    const rewindTo = cursor > REORG_REWIND ? cursor - REORG_REWIND : 0n;
    const floor = config.startBlock > 0n ? config.startBlock - 1n : 0n;
    const target = rewindTo < floor ? floor : rewindTo;
    console.warn(`[indexer] reorg detected at block ${cursor}; re-indexing from ${target + 1n}`);
    db.rewindTo(target);
    blockTimeCache.clear();
    return true;
  }

  /** Run one poll cycle. Returns the number of new blocks indexed. */
  async function runOnce(): Promise<number> {
    await detectReorg();
    const head = await client.getBlockNumber({ cacheTime: 0 });
    const safeHead = head > config.confirmations ? head - config.confirmations : 0n;
    const cursor = db.getCursor();
    let from = cursor !== null ? cursor + 1n : config.startBlock;
    if (from > safeHead) return 0;

    let indexed = 0;
    while (from <= safeHead) {
      const to = from + MAX_BLOCK_RANGE - 1n < safeHead ? from + MAX_BLOCK_RANGE - 1n : safeHead;
      const { keychain, transfers, times } = await fetchRange(from, to);
      const toBlock = await client.getBlock({ blockNumber: to });
      // One atomic write per range: rows and cursor advance together, so a
      // crash mid-range never leaves a half-indexed range behind the cursor.
      db.transaction(() => {
        for (const log of keychain) {
          safely("keychain", log, () => ingestKeychainLog(log, times.get(log.blockNumber!)!));
        }
        for (const log of transfers) {
          safely("transfer", log, () => ingestTransferLog(log, times.get(log.blockNumber!)!));
        }
        db.setCursor(to, toBlock.hash ?? null);
      });
      indexed += Number(to - from + 1n);
      from = to + 1n;
    }
    return indexed;
  }

  let stopped = false;
  let lastError: string | null = null;
  let lastSuccess: number | null = null;
  async function start() {
    while (!stopped) {
      try {
        await runOnce();
        lastError = null;
        lastSuccess = Date.now();
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.error("[indexer] poll failed:", lastError);
      }
      await new Promise((r) => setTimeout(r, config.pollIntervalMs));
    }
  }

  return {
    runOnce,
    start,
    stop() {
      stopped = true;
    },
    /** Poll health for /healthz: last error (if the latest poll failed) and last success time. */
    status() {
      return { lastError, lastSuccess };
    },
  };
}

export type Indexer = ReturnType<typeof createIndexer>;

/** eth_getLogs over raw request() returns hex quantities; normalize to viem Log shape. */
function normalize(raw: any): Log {
  return {
    ...raw,
    blockNumber: BigInt(raw.blockNumber),
    logIndex: typeof raw.logIndex === "string" ? Number.parseInt(raw.logIndex, 16) : raw.logIndex,
  };
}
