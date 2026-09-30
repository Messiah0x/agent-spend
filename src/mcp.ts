// MCP server (stdio): gives any MCP-capable agent "spend with a reason" as
// tools. Wraps the agent SDK, so every payment is budget-checked, carries a
// signed reason, and shows up explained on the Agent Spend dashboard.
//
//   AGENT_SPEND_URL=https://…  AGENT_ACCOUNT=0x…  AGENT_PRIVATE_KEY=0x…  npm run mcp
//
// Wire it into an MCP client (e.g. Claude Code) as a stdio server running
// `npx tsx src/mcp.ts` with those env vars. Logs go to stderr; stdout carries
// only protocol messages.

import { createInterface } from "node:readline";
import { formatUnits, getAddress, isAddress, parseUnits, type Address, type Hex } from "viem";
import { TIP20_DECIMALS } from "./chain.js";
import { BudgetExceededError, createAgent, devnetPayer, type Agent } from "./sdk.js";

const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const TOOLS = [
  {
    name: "get_budget",
    description:
      "Show this agent's remaining spending budget, as enforced on-chain by Tempo. Check this before paying for anything.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "pay",
    description:
      "Pay a recipient in stablecoins from this agent's budget. A clear reason is required: it is signed, linked to the " +
      "payment on-chain, and shown to the humans who oversee this agent. Fails without sending anything if the budget " +
      "can't cover it — then use request_approval if available.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient address (0x…)" },
        amount: { type: "string", description: 'Amount in token units, e.g. "12.50"' },
        reason: { type: "string", description: "Why this payment is needed (max 500 characters)" },
        description: { type: "string", description: "Optional: what is being bought (e.g. from an MPP 402 challenge)" },
        externalId: { type: "string", description: "Optional: invoice / order id from the seller" },
      },
      required: ["to", "amount", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "request_approval",
    description:
      "Ask the humans overseeing this agent for more budget when a payment exceeds what's left. They review it on the " +
      "Agent Spend dashboard; approval raises the on-chain limit. Returns a request id to check with check_approval.",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "string", description: 'Additional budget needed, in token units, e.g. "40.00"' },
        reason: { type: "string", description: "What the money is for and why it's needed now (max 500 characters)" },
        to: { type: "string", description: "Optional: intended recipient address" },
      },
      required: ["amount", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "check_approval",
    description: "Check the status of a budget request made with request_approval.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Request id returned by request_approval" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
] as const;

function text(t: string, isError = false): ToolResult {
  return { content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) };
}

function parseAmount(raw: unknown): bigint {
  if (typeof raw !== "string" || !/^\d+(\.\d{1,6})?$/.test(raw.trim())) {
    throw new Error('amount must be a decimal string with up to 6 decimals, e.g. "12.50"');
  }
  const v = parseUnits(raw.trim(), TIP20_DECIMALS);
  if (v <= 0n) throw new Error("amount must be positive");
  return v;
}

/** Protocol handler, separated from stdio so it can be tested directly. */
export function createMcpHandler(agent: Agent, extraTools: { name: string; description: string; inputSchema: unknown; run: (args: Record<string, unknown>) => Promise<ToolResult> }[] = []) {
  const fmt = (v: bigint) => formatUnits(v, TIP20_DECIMALS);

  async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      if (name === "get_budget") {
        const budgets = await agent.budgets();
        if (!budgets.length) return text("No spending limit is configured for this agent key.");
        return text(
          budgets
            .map((b) => {
              const resets = b.periodEnd > 0 ? `, resets ${new Date(b.periodEnd * 1000).toISOString()}` : "";
              return `${fmt(b.remaining)} ${b.symbol} remaining${resets}`;
            })
            .join("\n"),
        );
      }
      if (name === "pay") {
        if (typeof args.to !== "string" || !isAddress(args.to, { strict: false })) {
          return text("`to` must be a 0x address", true);
        }
        if (typeof args.reason !== "string" || !args.reason.trim()) return text("`reason` is required", true);
        const amount = parseAmount(args.amount);
        const context = {
          ...(typeof args.description === "string" && args.description ? { description: args.description } : {}),
          ...(typeof args.externalId === "string" && args.externalId ? { externalId: args.externalId } : {}),
        };
        const { txHash, memo } = await agent.pay({
          to: getAddress(args.to) as Address,
          amount,
          reason: args.reason,
          context: Object.keys(context).length ? context : undefined,
        });
        return text(`Paid ${fmt(amount)} to ${args.to}.\ntx: ${txHash}\nreason memo: ${memo}`);
      }
      if (name === "request_approval") {
        if (typeof args.reason !== "string" || !args.reason.trim()) return text("`reason` is required", true);
        if (args.to !== undefined && (typeof args.to !== "string" || !isAddress(args.to, { strict: false }))) {
          return text("`to` must be a 0x address", true);
        }
        const amount = parseAmount(args.amount);
        const res = await agent.requestApproval({
          amount,
          reason: args.reason,
          to: typeof args.to === "string" ? (getAddress(args.to) as Address) : undefined,
        });
        return text(`Budget request submitted (status: ${res.status}). id: ${res.id}\nA human will review it; check back with check_approval.`);
      }
      if (name === "check_approval") {
        if (typeof args.id !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(args.id)) return text("`id` must be a request id", true);
        const s = await agent.approval(args.id as Hex);
        const detail =
          s.status === "approved"
            ? ` New limit ${s.newLimit ? fmt(BigInt(s.newLimit)) : "?"} is live on-chain${s.txHash ? ` (tx ${s.txHash})` : ""}. You can retry the payment.`
            : s.status === "denied"
              ? ` Denied${s.note ? `: ${s.note}` : ""}. Do not retry this payment.`
              : s.status === "pending"
                ? " Still waiting for a human."
                : "";
        return text(`Request ${s.id}: ${s.status}.${detail}`);
      }
      const extra = extraTools.find((t) => t.name === name);
      if (extra) return await extra.run(args);
      return text(`Unknown tool: ${name}`, true);
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        return text(
          `Not paid: ${fmt(err.requested)} exceeds the remaining budget of ${fmt(err.remaining)}. ` +
            `Nothing was sent. Ask a human to raise the limit (request_approval).`,
          true,
        );
      }
      return text(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  return async function handle(msg: JsonRpcRequest): Promise<object | null> {
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id ?? null, result });
    const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
    // Notifications (no id) never get a response.
    if (msg.id === undefined || msg.id === null) return null;
    switch (msg.method) {
      case "initialize":
        return reply({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "agent-spend", version: "0.2.0" },
          instructions:
            "Spend money only through the `pay` tool, always with an honest, specific reason. Check `get_budget` first.",
        });
      case "ping":
        return reply({});
      case "tools/list":
        return reply({
          tools: [...TOOLS, ...extraTools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))],
        });
      case "tools/call": {
        const name = msg.params?.name;
        if (typeof name !== "string") return fail(-32602, "tool name required");
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        return reply(await callTool(name, args));
      }
      default:
        return fail(-32601, `method not found: ${msg.method}`);
    }
  };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const account = getAddress(required("AGENT_ACCOUNT"));
  const privateKey = required("AGENT_PRIVATE_KEY") as Hex;
  const rpcUrl = process.env.TEMPO_RPC_URL;
  const agent = createAgent({
    baseUrl: required("AGENT_SPEND_URL"),
    account,
    privateKey,
    rpcUrl,
    chainId: process.env.TEMPO_CHAIN_ID ? Number(process.env.TEMPO_CHAIN_ID) : undefined,
    ...(process.env.AGENT_SPEND_DEVNET === "1"
      ? {
          payer: devnetPayer({
            rpcUrl: rpcUrl ?? "http://localhost:8545",
            account,
            keyId: (await import("viem/accounts")).privateKeyToAccount(privateKey).address,
          }),
        }
      : {}),
  });
  const handle = createMcpHandler(agent);
  console.error(`agent-spend MCP server ready (agent key ${agent.keyId})`);

  const rl = createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg: JsonRpcRequest;
    try {
      msg = JSON.parse(line) as JsonRpcRequest;
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })}\n`);
      return;
    }
    const res = await handle(msg);
    if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
  });
}

if (process.argv[1]?.endsWith("mcp.ts")) {
  void main();
}
