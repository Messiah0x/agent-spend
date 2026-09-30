// Budget health: remaining vs. (estimated) limit per agent key, and a
// background check that notifies once per budget period when an agent runs
// low. Remaining is always the live on-chain value; only the limit is an
// estimate (initial limits aren't evented — see Db.limitEstimates).

import type { Address } from "viem";
import type { Config } from "./config.js";
import type { Db, KeyRow } from "./db.js";
import { keyStatus } from "./keys.js";
import type { Notifier } from "./notify.js";
import type { Reader, RemainingBudget } from "./reads.js";
import { formatAmount } from "./format.js";

export interface BudgetHealth extends RemainingBudget {
  /** Estimated configured limit (null when there's no signal yet). */
  limit: bigint | null;
  /** Remaining as % of limit, 0–100 (null without a limit estimate). */
  pct: number | null;
  low: boolean;
  exhausted: boolean;
}

export function assessBudgets(config: Config, db: Db, key: KeyRow, budgets: RemainingBudget[]): BudgetHealth[] {
  const limits = db.limitEstimates(key.account, key.key_id);
  return budgets.map((b) => {
    const est = limits.get(b.token.toLowerCase()) ?? null;
    // After a period reset remaining can exceed an estimate built from older spends.
    const limit = est !== null && b.remaining > est ? b.remaining : est;
    const pct = limit && limit > 0n ? Number((b.remaining * 1000n) / limit) / 10 : null;
    return {
      ...b,
      limit,
      pct,
      low: pct !== null && pct < config.alertThresholdPct,
      exhausted: b.remaining === 0n,
    };
  });
}

/** Check every active key once; notify on newly low/exhausted budgets (deduped per period). */
export async function checkBudgetAlerts(config: Config, db: Db, reader: Reader, notify: Notifier) {
  const labels = db.listLabels();
  for (const key of db.listKeys()) {
    if (keyStatus(key) !== "active") continue;
    const { budgets, unavailable } = await reader.remainingBudgets(key.account as Address, key.key_id as Address);
    if (unavailable) continue;
    for (const h of assessBudgets(config, db, key, budgets)) {
      if (!h.low && !h.exhausted) continue;
      const kind = h.exhausted ? "exhausted" : "low";
      const window = `${h.token.toLowerCase()}:${h.periodEnd}`;
      if (!db.markAlertSent(key.account, key.key_id, kind, window)) continue;
      const name = labels.get(`${key.account}|${key.key_id}`) ?? key.key_id;
      const text = h.exhausted
        ? `🛑 Agent "${name}" has exhausted its ${h.symbol} budget. Payments will be rejected on-chain until the limit is raised or the period resets.`
        : `⚠️ Agent "${name}" is low on budget: ${formatAmount(h.remaining)} ${h.symbol} left (${h.pct}% of its limit).`;
      await notify(text);
    }
  }
}
