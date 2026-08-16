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

  const blockTimes = new Map<bigint, number>();
  async function blockTime(blockNumber: bigint): Promise<number> {
    const cached = blockTimes.get(blockNumber);
    if (cached !== undefined) return cached;
    const block = await client.getBlock({ blockNumber });
    const t = Number(block.timestamp);
    blockTimes.set(blockNumber, t);
    if (blockTimes.size > 1024) {
      for (const k of blockTimes.keys()) {
        if (blockTimes.size <= 512) break;
        blockTimes.delete(k);
      }
    }
    return t;
  }

  async function ingestKeychainLog(log: Log) {
    const decoded = decodeEventLog({
      abi: keychainEventsAbi,
      data: log.data,
      topics: log.topics,
    });
    const time = await blockTime(log.blockNumber!);
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

  async function ingestTransferLog(log: Log) {
    const decoded = decodeEventLog({
      abi: tip20EventsAbi,
      data: log.data,
      topics: log.topics,
    });
    const time = await blockTime(log.blockNumber!);
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

  async function indexRange(fromBlock: bigint, toBlock: bigint) {
    // Both filters constrain topic1 (account for keychain events, `from`
    // for TIP-20 transfers) to the watched accounts, server-side.
    const [keychainLogs, transferLogs] = await Promise.all([
      client.request({
        method: "eth_getLogs",
        params: [
          {
            address: ACCOUNT_KEYCHAIN_ADDRESS,
            topics: [keychainTopic0, accountTopics],
            fromBlock: `0x${fromBlock.toString(16)}`,
            toBlock: `0x${toBlock.toString(16)}`,
          },
        ],
      }),
      client.request({
        method: "eth_getLogs",
        params: [
          {
            address: tokenAddresses,
            topics: [tip20Topic0, accountTopics],
            fromBlock: `0x${fromBlock.toString(16)}`,
            toBlock: `0x${toBlock.toString(16)}`,
          },
        ],
      }),
    ]);

    // Resolve block timestamps before the synchronous DB transaction.
    for (const log of [...keychainLogs, ...transferLogs] as Log[]) {
      if (log.blockNumber != null) await blockTime(BigInt(log.blockNumber));
    }

    for (const raw of keychainLogs as unknown as Log[]) {
      await ingestKeychainLog(normalize(raw));
    }
    for (const raw of transferLogs as unknown as Log[]) {
      await ingestTransferLog(normalize(raw));
    }
  }

  /** Run one poll cycle. Returns the number of new blocks indexed. */
  async function runOnce(): Promise<number> {
    const head = await client.getBlockNumber({ cacheTime: 0 });
    const safeHead = head > config.confirmations ? head - config.confirmations : 0n;
    const cursor = db.getCursor();
    let from = cursor !== null ? cursor + 1n : config.startBlock;
    if (from > safeHead) return 0;

    let indexed = 0;
    while (from <= safeHead) {
      const to = from + MAX_BLOCK_RANGE - 1n < safeHead ? from + MAX_BLOCK_RANGE - 1n : safeHead;
      await indexRange(from, to);
      db.setCursor(to);
      indexed += Number(to - from + 1n);
      from = to + 1n;
    }
    return indexed;
  }

  let stopped = false;
  async function start() {
    while (!stopped) {
      try {
        await runOnce();
      } catch (err) {
        console.error("[indexer] poll failed:", err instanceof Error ? err.message : err);
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
  };
}

/** eth_getLogs over raw request() returns hex quantities; normalize to viem Log shape. */
function normalize(raw: any): Log {
  return {
    ...raw,
    blockNumber: BigInt(raw.blockNumber),
    logIndex: typeof raw.logIndex === "string" ? Number.parseInt(raw.logIndex, 16) : raw.logIndex,
  };
}
