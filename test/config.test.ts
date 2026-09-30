import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const base = { WATCHED_ACCOUNTS: "0x1111111111111111111111111111111111111111" };

describe("config", () => {
  it("treats blank env vars as unset (hosting dashboards often leave them empty)", () => {
    const c = loadConfig({
      ...base,
      PORT: "",
      START_BLOCK: " ",
      CONFIRMATIONS: "",
      TEMPO_RPC_URL: "",
      TOKENS: "",
      OPERATOR_MODE: "",
      WEBHOOK_URL: "",
    } as NodeJS.ProcessEnv);
    expect(c.port).toBe(3000);
    expect(c.startBlock).toBe(0n);
    expect(c.confirmations).toBe(2n);
    expect(c.rpcUrl).toBe("https://rpc.moderato.tempo.xyz");
    expect(c.tokens).toHaveLength(1);
    expect(c.operator).toBeUndefined();
    expect(c.webhookUrl).toBeUndefined();
  });

  it("still rejects malformed values with a clear message", () => {
    expect(() => loadConfig({ ...base, PORT: "abc" } as NodeJS.ProcessEnv)).toThrow(/PORT/);
    expect(() => loadConfig({ ...base, START_BLOCK: "-1" } as NodeJS.ProcessEnv)).toThrow(/START_BLOCK/);
    expect(() => loadConfig({ ...base, OPERATOR_MODE: "god" } as NodeJS.ProcessEnv)).toThrow(/OPERATOR_MODE/);
  });
});
