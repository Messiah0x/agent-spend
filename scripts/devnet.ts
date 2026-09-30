// Local Tempo dev fixture: a minimal JSON-RPC server that emits the exact
// ABI-encoded events the real AccountKeychain precompile and TIP-20 tokens
// emit (signatures verified against tempoxyz/tempo sources), at the real
// precompile addresses. Used because live Tempo RPC endpoints are not
// reachable from every dev environment. NOT a Tempo node: it implements only
// what the indexer and dashboard consume, plus dev_* methods to drive it.

import { createServer } from "node:http";
import {
  encodeEventTopics,
  encodeAbiParameters,
  encodeFunctionResult,
  decodeFunctionData,
  keccak256,
  toHex,
  pad,
  type Address,
  type Hex,
} from "viem";
import {
  ACCOUNT_KEYCHAIN_ADDRESS,
  MODERATO_CHAIN_ID,
  keychainEventsAbi,
  keychainReadsAbi,
  tip20EventsAbi,
} from "../src/chain.js";

const PORT = Number(process.env.DEVNET_PORT ?? "8545");

interface RawLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  transactionHash: Hex;
  transactionIndex: Hex;
  blockHash: Hex;
  logIndex: Hex;
  removed: false;
}

interface Block {
  number: number;
  timestamp: number;
  hash: Hex;
  logs: RawLog[];
}

interface LimitState {
  max: bigint;
  remaining: bigint;
  period: number;
  periodEnd: number;
}

interface KeyState {
  signatureType: number;
  expiry: number;
  revoked: boolean;
  limits: Map<string, LimitState>; // token (lowercase) -> limit
}

const blocks: Block[] = [];
const keys = new Map<string, KeyState>(); // `${account}|${keyId}` lowercase
let txCounter = 0;
let reorgSalt = 0; // bumped by dev_reorg so replacement blocks get new hashes

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function mineBlock(logs: Omit<RawLog, "blockNumber" | "blockHash" | "logIndex" | "removed">[] = []): Block {
  const number = blocks.length;
  const hash = keccak256(toHex(`block-${number}-${reorgSalt}`));
  const block: Block = {
    number,
    timestamp: now(),
    hash,
    logs: logs.map((l, i) => ({
      ...l,
      blockNumber: toHex(number),
      blockHash: hash,
      logIndex: toHex(i),
      removed: false,
    })),
  };
  blocks.push(block);
  return block;
}

function newTxHash(): Hex {
  return keccak256(toHex(`tx-${txCounter++}`));
}

function keyOf(account: string, keyId: string): string {
  return `${account.toLowerCase()}|${keyId.toLowerCase()}`;
}

function topicsFor(eventName: string, args: Record<string, unknown>): Hex[] {
  return encodeEventTopics({ abi: keychainEventsAbi, eventName, args } as any) as Hex[];
}

// ── dev_* handlers ───────────────────────────────────────────────────────────

function devAuthorizeKey(p: {
  account: Address;
  keyId: Address;
  signatureType?: number;
  expiry?: number;
  token: Address;
  limit: string;
  period?: number;
}) {
  const signatureType = p.signatureType ?? 0;
  const expiry = p.expiry ?? 0;
  const period = p.period ?? 0;
  const limit = BigInt(p.limit);
  keys.set(keyOf(p.account, p.keyId), {
    signatureType,
    expiry,
    revoked: false,
    limits: new Map([
      [
        p.token.toLowerCase(),
        { max: limit, remaining: limit, period, periodEnd: period > 0 ? now() + period : 0 },
      ],
    ]),
  });
  const tx = newTxHash();
  // Real chain behavior: authorizeKey emits KeyAuthorized only (initial
  // limits are not evented; they are readable via getRemainingLimit*).
  const block = mineBlock([
    {
      address: ACCOUNT_KEYCHAIN_ADDRESS,
      topics: topicsFor("KeyAuthorized", { account: p.account, publicKey: p.keyId }),
      data: encodeAbiParameters(
        [{ type: "uint8" }, { type: "uint64" }],
        [signatureType, BigInt(expiry)],
      ),
      transactionHash: tx,
      transactionIndex: "0x0",
    },
  ]);
  return { txHash: tx, blockNumber: block.number };
}

function devUpdateLimit(p: { account: Address; keyId: Address; token: Address; newLimit: string }) {
  const k = keys.get(keyOf(p.account, p.keyId));
  if (!k) throw new Error("key not found");
  const newLimit = BigInt(p.newLimit);
  const existing = k.limits.get(p.token.toLowerCase());
  // Mirrors TIP-1011 updateSpendingLimit: sets limit and remaining, keeps period.
  k.limits.set(p.token.toLowerCase(), {
    max: newLimit,
    remaining: newLimit,
    period: existing?.period ?? 0,
    periodEnd: existing?.periodEnd ?? 0,
  });
  const tx = newTxHash();
  const block = mineBlock([
    {
      address: ACCOUNT_KEYCHAIN_ADDRESS,
      topics: topicsFor("SpendingLimitUpdated", {
        account: p.account,
        publicKey: p.keyId,
        token: p.token,
      }),
      data: encodeAbiParameters([{ type: "uint256" }], [newLimit]),
      transactionHash: tx,
      transactionIndex: "0x0",
    },
  ]);
  return { txHash: tx, blockNumber: block.number };
}

function devRevokeKey(p: { account: Address; keyId: Address }) {
  const k = keys.get(keyOf(p.account, p.keyId));
  if (!k) throw new Error("key not found");
  k.revoked = true;
  const tx = newTxHash();
  const block = mineBlock([
    {
      address: ACCOUNT_KEYCHAIN_ADDRESS,
      topics: topicsFor("KeyRevoked", { account: p.account, publicKey: p.keyId }),
      data: "0x",
      transactionHash: tx,
      transactionIndex: "0x0",
    },
  ]);
  return { txHash: tx, blockNumber: block.number };
}

function devPay(p: {
  account: Address;
  keyId: Address;
  token: Address;
  to: Address;
  amount: string;
  memo?: Hex;
  /** Optional per-tx fee (base units) debited from the key's limit, as on real Tempo. */
  fee?: string;
}) {
  const k = keys.get(keyOf(p.account, p.keyId));
  if (!k) throw new Error("key not found");
  if (k.revoked) throw new Error("KeyRevoked");
  const limit = k.limits.get(p.token.toLowerCase());
  if (!limit) throw new Error("no spending limit for token");
  const amount = BigInt(p.amount);
  if (limit.period > 0 && now() >= limit.periodEnd) {
    limit.remaining = limit.max;
    while (limit.periodEnd <= now()) limit.periodEnd += limit.period;
  }
  const fee = BigInt(p.fee ?? "0");
  if (amount + fee > limit.remaining) throw new Error("SpendingLimitExceeded");
  limit.remaining -= amount;

  const tx = newTxHash();
  const spendLog = {
    address: ACCOUNT_KEYCHAIN_ADDRESS as Hex,
    topics: topicsFor("AccessKeySpend", {
      account: p.account,
      publicKey: p.keyId,
      token: p.token,
    }),
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }],
      [amount, limit.remaining],
    ),
    transactionHash: tx,
    transactionIndex: "0x0" as Hex,
  };
  // Real TIP-20 behavior: transferWithMemo emits BOTH a plain Transfer and a
  // TransferWithMemo for the same movement of funds.
  const transferLogs = [
    {
      address: p.token as Hex,
      topics: encodeEventTopics({
        abi: tip20EventsAbi,
        eventName: "Transfer",
        args: { from: p.account, to: p.to },
      } as any) as Hex[],
      data: encodeAbiParameters([{ type: "uint256" }], [amount]),
      transactionHash: tx,
      transactionIndex: "0x0" as Hex,
    },
  ];
  if (p.memo) {
    transferLogs.push({
      address: p.token as Hex,
      topics: encodeEventTopics({
        abi: tip20EventsAbi,
        eventName: "TransferWithMemo",
        args: { from: p.account, to: p.to, memo: p.memo },
      } as any) as Hex[],
      data: encodeAbiParameters([{ type: "uint256" }], [amount]),
      transactionHash: tx,
      transactionIndex: "0x0" as Hex,
    });
  }
  // Real Tempo behavior: a flat per-transaction fee is also debited from the
  // key's limit as a second AccessKeySpend, with no matching user transfer.
  const feeLogs = [];
  if (fee > 0n) {
    limit.remaining -= fee;
    feeLogs.push({
      address: ACCOUNT_KEYCHAIN_ADDRESS as Hex,
      topics: topicsFor("AccessKeySpend", { account: p.account, publicKey: p.keyId, token: p.token }),
      data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [fee, limit.remaining]),
      transactionHash: tx,
      transactionIndex: "0x0" as Hex,
    });
  }
  const block = mineBlock([spendLog, ...transferLogs, ...feeLogs]);
  return { txHash: tx, blockNumber: block.number, remaining: limit.remaining.toString() };
}

/**
 * Simulate a reorg: drop the last `depth` blocks (and their logs) and mine
 * the same number of empty replacement blocks with different hashes. Key/limit
 * state is not rolled back — this exists to exercise the indexer's reorg path.
 */
function devReorg(p: { depth?: number }) {
  const depth = Math.min(p.depth ?? 1, blocks.length - 1);
  blocks.splice(blocks.length - depth, depth);
  reorgSalt++;
  for (let i = 0; i < depth; i++) mineBlock();
  return { blockNumber: blocks.length - 1 };
}

// ── eth_* handlers ───────────────────────────────────────────────────────────

function parseBlockTag(tag: string): number {
  if (tag === "latest" || tag === "safe" || tag === "finalized" || tag === "pending") {
    return blocks.length - 1;
  }
  return Number.parseInt(tag, 16);
}

function ethGetLogs(filter: {
  address?: Hex | Hex[];
  topics?: (Hex | Hex[] | null)[];
  fromBlock?: string;
  toBlock?: string;
}): RawLog[] {
  const from = filter.fromBlock ? parseBlockTag(filter.fromBlock) : 0;
  const to = filter.toBlock ? parseBlockTag(filter.toBlock) : blocks.length - 1;
  const addresses = filter.address
    ? (Array.isArray(filter.address) ? filter.address : [filter.address]).map((a) =>
        a.toLowerCase(),
      )
    : null;
  const out: RawLog[] = [];
  for (let n = Math.max(0, from); n <= Math.min(to, blocks.length - 1); n++) {
    for (const log of blocks[n]!.logs) {
      if (addresses && !addresses.includes(log.address.toLowerCase())) continue;
      if (filter.topics) {
        let match = true;
        for (let i = 0; i < filter.topics.length; i++) {
          const want = filter.topics[i];
          if (want == null) continue;
          const have = log.topics[i]?.toLowerCase();
          const wants = (Array.isArray(want) ? want : [want]).map((t) => t.toLowerCase());
          if (!have || !wants.includes(have)) {
            match = false;
            break;
          }
        }
        if (!match) continue;
      }
      out.push(log);
    }
  }
  return out;
}

function ethGetBlockByNumber(tag: string) {
  const n = parseBlockTag(tag);
  const b = blocks[n];
  if (!b) return null;
  return {
    number: toHex(b.number),
    hash: b.hash,
    parentHash: n > 0 ? blocks[n - 1]!.hash : pad("0x0", { size: 32 }),
    timestamp: toHex(b.timestamp),
    nonce: "0x0000000000000000",
    difficulty: "0x0",
    gasLimit: "0x1c9c380",
    gasUsed: "0x0",
    miner: pad("0x0", { size: 20 }),
    extraData: "0x",
    baseFeePerGas: "0x0",
    logsBloom: `0x${"0".repeat(512)}`,
    mixHash: pad("0x0", { size: 32 }),
    receiptsRoot: pad("0x0", { size: 32 }),
    sha3Uncles: pad("0x0", { size: 32 }),
    size: "0x0",
    stateRoot: pad("0x0", { size: 32 }),
    transactionsRoot: pad("0x0", { size: 32 }),
    totalDifficulty: "0x0",
    transactions: [],
    uncles: [],
  };
}

function ethCall(call: { to?: Hex; data?: Hex }): Hex {
  if (call.to?.toLowerCase() !== ACCOUNT_KEYCHAIN_ADDRESS.toLowerCase() || !call.data) {
    return "0x";
  }
  const { functionName, args } = decodeFunctionData({ abi: keychainReadsAbi, data: call.data });
  if (functionName === "getRemainingLimitWithPeriod") {
    const [account, keyId, token] = args as [Address, Address, Address];
    const k = keys.get(keyOf(account, keyId));
    const limit = k && !k.revoked ? k.limits.get(token.toLowerCase()) : undefined;
    let remaining = limit?.remaining ?? 0n;
    if (limit && limit.period > 0 && now() >= limit.periodEnd) remaining = limit.max;
    return encodeFunctionResult({
      abi: keychainReadsAbi,
      functionName: "getRemainingLimitWithPeriod",
      result: [remaining, BigInt(limit?.periodEnd ?? 0)],
    });
  }
  return "0x";
}

// ── JSON-RPC plumbing ────────────────────────────────────────────────────────

function handle(method: string, params: any[]): unknown {
  switch (method) {
    case "eth_chainId":
      return toHex(MODERATO_CHAIN_ID);
    case "eth_blockNumber":
      return toHex(blocks.length - 1);
    case "eth_getBlockByNumber":
      return ethGetBlockByNumber(params[0]);
    case "eth_getLogs":
      return ethGetLogs(params[0]);
    case "eth_call":
      return ethCall(params[0]);
    case "dev_authorizeKey":
      return devAuthorizeKey(params[0]);
    case "dev_updateLimit":
      return devUpdateLimit(params[0]);
    case "dev_revokeKey":
      return devRevokeKey(params[0]);
    case "dev_pay":
      return devPay(params[0]);
    case "dev_mine":
      return { blockNumber: mineBlock().number };
    case "dev_reorg":
      return devReorg(params[0] ?? {});
    default:
      throw new Error(`method not supported: ${method}`);
  }
}

export function startDevnet(port = PORT) {
  mineBlock(); // genesis
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      let id: unknown = null;
      try {
        const rpc = JSON.parse(body);
        id = rpc.id;
        const result = handle(rpc.method, rpc.params ?? []);
        res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
      } catch (err) {
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
          }),
        );
      }
    });
  });
  server.listen(port);
  return server;
}

const isMain = process.argv[1]?.endsWith("devnet.ts");
if (isMain) {
  startDevnet();
  console.log(`tempo devnet fixture listening on http://localhost:${PORT} (chain ${MODERATO_CHAIN_ID})`);
}
