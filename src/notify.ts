// Outbound notifications: approval requests and low-budget alerts, posted as
// Slack-compatible `{ text }` JSON to an operator-configured webhook.
// Best effort: a failing webhook is logged, never allowed to break a request.

import type { Config } from "./config.js";

export type Notifier = (text: string) => Promise<void>;

export function createNotifier(config: Config): Notifier {
  return async (text: string) => {
    if (!config.webhookUrl) return;
    try {
      const res = await fetch(config.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Escape Slack control sequences: agent-supplied text (reasons) must not
        // be able to inject mentions like <!channel> or links.
        body: JSON.stringify({ text: text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") }),
        signal: AbortSignal.timeout(5_000),
        redirect: "error",
      });
      if (!res.ok) console.warn(`[notify] webhook responded ${res.status}`);
    } catch (err) {
      console.warn("[notify] webhook failed:", err instanceof Error ? err.message : err);
    }
  };
}
