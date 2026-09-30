import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ReasonRecord } from "./reasons.js";

export interface KeyRow {
  account: string;
  key_id: string;
  signature_type: number;
  expiry: number;
  authorized_block: number;
  authorized_tx: string;
  authorized_time: number;
  revoked_block: number | null;
  revoked_tx: string | null;
  revoked_time: number | null;
}

export interface SpendRow {
  tx_hash: string;
  log_index: number;
  block_number: number;
  block_time: number;
  account: string;
  key_id: string;
  token: string;
  amount: string;
  remaining: string;
}

export interface TransferRow {
  tx_hash: string;
  log_index: number;
  block_number: number;
  block_time: number;
  from_addr: string;
  to_addr: string;
  token: string;
  amount: string;
  memo: string | null;
}

export interface LimitUpdateRow {
  tx_hash: string;
  log_index: number;
  block_number: number;
  block_time: number;
  account: string;
  key_id: string;
  token: string;
  new_limit: string;
}

/**
 * A spend joined with the same-transaction token transfer (recipient + memo).
 *
 * `kind` classifies the budget debit:
 * - `payment` — matched to a TIP-20 transfer of the same token/amount;
 * - `fee`     — unmatched, but another debit in the same tx is a payment
 *               (Tempo's per-transaction fee debited from the key's limit);
 * - `other`   — unmatched and alone in its tx (e.g. a non-transfer call).
 */
export interface PaymentRow extends SpendRow {
  to_addr: string | null;
  memo: string | null;
  kind: "payment" | "fee" | "other";
}

export interface KeyEventRow {
  kind: "authorized" | "revoked" | "limit_updated";
  block_time: number;
  tx_hash: string;
  account: string;
  key_id: string;
  token: string | null;
  new_limit: string | null;
}

/**
 * CTE classifying every AccessKeySpend (see PaymentRow.kind). The transfer
 * subqueries share one ordering so recipient and memo come from the same row.
 */
const CLASSIFIED_SPENDS = `
  WITH joined AS (
    SELECT s.*,
      (SELECT t.to_addr FROM transfers t
         WHERE t.tx_hash = s.tx_hash AND t.token = s.token AND t.amount = s.amount
         ORDER BY (t.memo IS NULL), t.log_index LIMIT 1) AS to_addr,
      (SELECT t.memo FROM transfers t
         WHERE t.tx_hash = s.tx_hash AND t.token = s.token AND t.amount = s.amount
         ORDER BY (t.memo IS NULL), t.log_index LIMIT 1) AS memo,
      EXISTS (SELECT 1 FROM transfers t
         WHERE t.tx_hash = s.tx_hash AND t.token = s.token AND t.amount = s.amount) AS matched
    FROM spends s
  ),
  classified AS (
    SELECT j.*,
      CASE
        WHEN j.matched THEN 'payment'
        WHEN EXISTS (SELECT 1 FROM joined j2 WHERE j2.tx_hash = j.tx_hash AND j2.matched) THEN 'fee'
        ELSE 'other'
      END AS kind
    FROM joined j
  )`;

export type ApprovalStatus = "pending" | "approved" | "denied" | "failed";

export interface ApprovalRow {
  id: string;
  account: string;
  key_id: string;
  token: string;
  amount: string;
  to_addr: string | null;
  reason: string;
  request_json: string;
  signature: string;
  status: ApprovalStatus;
  created_time: number;
  decided_time: number | null;
  decided_by: string | null;
  new_limit: string | null;
  tx_hash: string | null;
  note: string | null;
}

export interface AuditRow {
  id: number;
  time: number;
  actor: string;
  action: string;
  account: string | null;
  key_id: string | null;
  detail: string;
  tx_hash: string | null;
  ok: number;
}

export interface StoredReason {
  memo: string;
  account: string;
  key_id: string;
  record: ReasonRecord;
  signature: string;
  created_time: number;
}

export function openDb(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS cursor (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_block INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS keys (
      account TEXT NOT NULL,
      key_id TEXT NOT NULL,
      signature_type INTEGER NOT NULL,
      expiry INTEGER NOT NULL,
      authorized_block INTEGER NOT NULL,
      authorized_tx TEXT NOT NULL,
      authorized_time INTEGER NOT NULL,
      revoked_block INTEGER,
      revoked_tx TEXT,
      revoked_time INTEGER,
      PRIMARY KEY (account, key_id)
    );
    CREATE TABLE IF NOT EXISTS spends (
      tx_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      block_number INTEGER NOT NULL,
      block_time INTEGER NOT NULL,
      account TEXT NOT NULL,
      key_id TEXT NOT NULL,
      token TEXT NOT NULL,
      amount TEXT NOT NULL,
      remaining TEXT NOT NULL,
      PRIMARY KEY (tx_hash, log_index)
    );
    CREATE INDEX IF NOT EXISTS idx_spends_key ON spends (account, key_id, block_number DESC);
    CREATE TABLE IF NOT EXISTS transfers (
      tx_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      block_number INTEGER NOT NULL,
      block_time INTEGER NOT NULL,
      from_addr TEXT NOT NULL,
      to_addr TEXT NOT NULL,
      token TEXT NOT NULL,
      amount TEXT NOT NULL,
      memo TEXT,
      PRIMARY KEY (tx_hash, log_index)
    );
    CREATE INDEX IF NOT EXISTS idx_transfers_tx ON transfers (tx_hash);
    CREATE TABLE IF NOT EXISTS limit_updates (
      tx_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      block_number INTEGER NOT NULL,
      block_time INTEGER NOT NULL,
      account TEXT NOT NULL,
      key_id TEXT NOT NULL,
      token TEXT NOT NULL,
      new_limit TEXT NOT NULL,
      PRIMARY KEY (tx_hash, log_index)
    );
    CREATE TABLE IF NOT EXISTS reasons (
      memo TEXT PRIMARY KEY,
      account TEXT NOT NULL,
      key_id TEXT NOT NULL,
      record_json TEXT NOT NULL,
      signature TEXT NOT NULL,
      created_time INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reasons_key ON reasons (account, key_id, created_time DESC);
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      account TEXT NOT NULL,
      key_id TEXT NOT NULL,
      token TEXT NOT NULL,
      amount TEXT NOT NULL,
      to_addr TEXT,
      reason TEXT NOT NULL,
      request_json TEXT NOT NULL,
      signature TEXT NOT NULL,
      status TEXT NOT NULL,
      created_time INTEGER NOT NULL,
      decided_time INTEGER,
      decided_by TEXT,
      new_limit TEXT,
      tx_hash TEXT,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals (status, created_time DESC);
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time INTEGER NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      account TEXT,
      key_id TEXT,
      detail TEXT NOT NULL,
      tx_hash TEXT,
      ok INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alerts_sent (
      account TEXT NOT NULL,
      key_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      window TEXT NOT NULL,
      time INTEGER NOT NULL,
      PRIMARY KEY (account, key_id, kind, window)
    );
    CREATE TABLE IF NOT EXISTS agent_labels (
      account TEXT NOT NULL,
      key_id TEXT NOT NULL,
      label TEXT NOT NULL,
      updated_time INTEGER NOT NULL,
      PRIMARY KEY (account, key_id)
    );
  `);
  // Migration: databases created before reorg detection lack the cursor's
  // block hash column.
  const cursorCols = db.prepare("PRAGMA table_info(cursor)").all() as { name: string }[];
  if (!cursorCols.some((c) => c.name === "block_hash")) {
    db.exec("ALTER TABLE cursor ADD COLUMN block_hash TEXT");
  }

  const stmts = {
    getCursor: db.prepare("SELECT last_block, block_hash FROM cursor WHERE id = 1"),
    setCursor: db.prepare(
      `INSERT INTO cursor (id, last_block, block_hash) VALUES (1, ?, ?)
       ON CONFLICT (id) DO UPDATE SET last_block = excluded.last_block, block_hash = excluded.block_hash`,
    ),
    insertKey: db.prepare(`
      INSERT INTO keys (account, key_id, signature_type, expiry, authorized_block, authorized_tx, authorized_time)
      VALUES (@account, @key_id, @signature_type, @expiry, @authorized_block, @authorized_tx, @authorized_time)
      ON CONFLICT (account, key_id) DO NOTHING
    `),
    revokeKey: db.prepare(
      "UPDATE keys SET revoked_block = ?, revoked_tx = ?, revoked_time = ? WHERE account = ? AND key_id = ?",
    ),
    insertSpend: db.prepare(`
      INSERT OR IGNORE INTO spends (tx_hash, log_index, block_number, block_time, account, key_id, token, amount, remaining)
      VALUES (@tx_hash, @log_index, @block_number, @block_time, @account, @key_id, @token, @amount, @remaining)
    `),
    insertTransfer: db.prepare(`
      INSERT OR IGNORE INTO transfers (tx_hash, log_index, block_number, block_time, from_addr, to_addr, token, amount, memo)
      VALUES (@tx_hash, @log_index, @block_number, @block_time, @from_addr, @to_addr, @token, @amount, @memo)
    `),
    insertLimitUpdate: db.prepare(`
      INSERT OR IGNORE INTO limit_updates (tx_hash, log_index, block_number, block_time, account, key_id, token, new_limit)
      VALUES (@tx_hash, @log_index, @block_number, @block_time, @account, @key_id, @token, @new_limit)
    `),
    upsertLabel: db.prepare(`
      INSERT INTO agent_labels (account, key_id, label, updated_time)
      VALUES (@account, @key_id, @label, @updated_time)
      ON CONFLICT (account, key_id) DO UPDATE SET label = excluded.label, updated_time = excluded.updated_time
    `),
    clearLabel: db.prepare("DELETE FROM agent_labels WHERE account = ? AND key_id = ?"),
  };

  return {
    raw: db,

    getCursor(): bigint | null {
      const row = stmts.getCursor.get() as { last_block: number } | undefined;
      return row ? BigInt(row.last_block) : null;
    },
    /** Hash of the last indexed block, for reorg detection (null on old DBs). */
    getCursorHash(): string | null {
      const row = stmts.getCursor.get() as { block_hash: string | null } | undefined;
      return row?.block_hash ?? null;
    },
    setCursor(block: bigint, blockHash: string | null = null) {
      stmts.setCursor.run(Number(block), blockHash);
    },
    /**
     * Discard everything indexed above `block` (chain reorg) and move the
     * cursor back so those blocks are re-indexed from the canonical chain.
     * Agent Spend's own data (labels) is untouched.
     */
    rewindTo(block: bigint) {
      const b = Number(block);
      db.transaction(() => {
        db.prepare("DELETE FROM spends WHERE block_number > ?").run(b);
        db.prepare("DELETE FROM transfers WHERE block_number > ?").run(b);
        db.prepare("DELETE FROM limit_updates WHERE block_number > ?").run(b);
        db.prepare("DELETE FROM keys WHERE authorized_block > ?").run(b);
        db.prepare(
          "UPDATE keys SET revoked_block = NULL, revoked_tx = NULL, revoked_time = NULL WHERE revoked_block > ?",
        ).run(b);
        stmts.setCursor.run(b, null);
      })();
    },
    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },
    insertKey(row: Omit<KeyRow, "revoked_block" | "revoked_tx" | "revoked_time">) {
      stmts.insertKey.run(row);
    },
    markKeyRevoked(account: string, keyId: string, block: number, tx: string, time: number) {
      stmts.revokeKey.run(block, tx, time, account, keyId);
    },
    insertSpend(row: SpendRow) {
      stmts.insertSpend.run(row);
    },
    insertTransfer(row: TransferRow) {
      stmts.insertTransfer.run(row);
    },
    insertLimitUpdate(row: LimitUpdateRow) {
      stmts.insertLimitUpdate.run(row);
    },

    /**
     * Set (or, with an empty/whitespace-only label, clear) the human-readable
     * name for one agent access key. Agent Spend's own data only — this never
     * touches Tempo. Addresses are lowercased to match how the indexer
     * stores them.
     */
    setLabel(account: string, keyId: string, label: string) {
      const acc = account.toLowerCase();
      const kid = keyId.toLowerCase();
      const trimmed = label.trim().slice(0, 64);
      if (!trimmed) {
        stmts.clearLabel.run(acc, kid);
        return;
      }
      stmts.upsertLabel.run({ account: acc, key_id: kid, label: trimmed, updated_time: Math.floor(Date.now() / 1000) });
    },
    /** All agent labels, keyed by `${account}|${key_id}` (both lowercase). */
    listLabels(): Map<string, string> {
      const rows = db.prepare("SELECT account, key_id, label FROM agent_labels").all() as {
        account: string;
        key_id: string;
        label: string;
      }[];
      return new Map(rows.map((r) => [`${r.account}|${r.key_id}`, r.label]));
    },

    /** Store a signed reason record. Idempotent on memo; returns false if it already existed. */
    insertReason(memo: string, record: ReasonRecord, signature: string): boolean {
      const res = db
        .prepare(
          `INSERT OR IGNORE INTO reasons (memo, account, key_id, record_json, signature, created_time)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(memo.toLowerCase(), record.account, record.keyId, JSON.stringify(record), signature, Math.floor(Date.now() / 1000));
      return res.changes > 0;
    },
    getReason(memo: string): StoredReason | null {
      const row = db.prepare("SELECT * FROM reasons WHERE memo = ?").get(memo.toLowerCase()) as
        | (Omit<StoredReason, "record"> & { record_json: string })
        | undefined;
      if (!row) return null;
      const { record_json, ...rest } = row;
      return { ...rest, record: JSON.parse(record_json) as ReasonRecord };
    },
    /** Reasons for many memos at once (lowercase memo → record). */
    reasonsFor(memos: (string | null)[]): Map<string, StoredReason> {
      const wanted = [...new Set(memos.filter((m): m is string => !!m).map((m) => m.toLowerCase()))];
      const out = new Map<string, StoredReason>();
      // Chunk to stay well under SQLite's bound-parameter limit.
      for (let i = 0; i < wanted.length; i += 500) {
        const chunk = wanted.slice(i, i + 500);
        const rows = db
          .prepare(`SELECT * FROM reasons WHERE memo IN (${chunk.map(() => "?").join(",")})`)
          .all(...chunk) as (Omit<StoredReason, "record"> & { record_json: string })[];
        for (const { record_json, ...rest } of rows) {
          out.set(rest.memo, { ...rest, record: JSON.parse(record_json) as ReasonRecord });
        }
      }
      return out;
    },
    /** Reasons a key submitted since `sinceUnix` (spam bound on the agent API). */
    reasonCountSince(account: string, keyId: string, sinceUnix: number): number {
      const row = db
        .prepare("SELECT COUNT(*) AS n FROM reasons WHERE account = ? AND key_id = ? AND created_time >= ?")
        .get(account.toLowerCase(), keyId.toLowerCase(), sinceUnix) as { n: number };
      return row.n;
    },
    getKey(account: string, keyId: string): KeyRow | null {
      return (
        (db.prepare("SELECT * FROM keys WHERE account = ? AND key_id = ?").get(
          account.toLowerCase(),
          keyId.toLowerCase(),
        ) as KeyRow | undefined) ?? null
      );
    },

    // ── Approvals ───────────────────────────────────────────────────────────
    insertApproval(row: Omit<ApprovalRow, "status" | "decided_time" | "decided_by" | "new_limit" | "tx_hash" | "note">): boolean {
      const res = db
        .prepare(
          `INSERT OR IGNORE INTO approvals (id, account, key_id, token, amount, to_addr, reason, request_json, signature, status, created_time)
           VALUES (@id, @account, @key_id, @token, @amount, @to_addr, @reason, @request_json, @signature, 'pending', @created_time)`,
        )
        .run(row);
      return res.changes > 0;
    },
    getApproval(id: string): ApprovalRow | null {
      return (db.prepare("SELECT * FROM approvals WHERE id = ?").get(id.toLowerCase()) as ApprovalRow | undefined) ?? null;
    },
    listApprovals(opts: { status?: ApprovalStatus; account?: string; keyId?: string; limit?: number } = {}): ApprovalRow[] {
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (opts.status) {
        where.push("status = ?");
        params.push(opts.status);
      }
      if (opts.account) {
        where.push("account = ?");
        params.push(opts.account.toLowerCase());
      }
      if (opts.keyId) {
        where.push("key_id = ?");
        params.push(opts.keyId.toLowerCase());
      }
      params.push(opts.limit ?? 200);
      return db
        .prepare(
          `SELECT * FROM approvals ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_time DESC, rowid DESC LIMIT ?`,
        )
        .all(...params) as ApprovalRow[];
    },
    pendingApprovalCount(account?: string, keyId?: string): number {
      const row = (
        account && keyId
          ? db
              .prepare("SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending' AND account = ? AND key_id = ?")
              .get(account.toLowerCase(), keyId.toLowerCase())
          : db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'").get()
      ) as { n: number };
      return row.n;
    },
    /**
     * Move a pending approval to a decided state. Returns false if it was no
     * longer pending (double-submit / concurrent decision) — callers must
     * not execute anything on-chain in that case.
     */
    claimApproval(id: string, decidedBy: string): boolean {
      const res = db
        .prepare(
          "UPDATE approvals SET status = 'approved', decided_time = ?, decided_by = ? WHERE id = ? AND status = 'pending'",
        )
        .run(Math.floor(Date.now() / 1000), decidedBy, id.toLowerCase());
      return res.changes > 0;
    },
    finishApproval(id: string, p: { status: ApprovalStatus; newLimit?: string | null; txHash?: string | null; note?: string | null; decidedBy?: string }) {
      db.prepare(
        `UPDATE approvals SET status = ?, new_limit = COALESCE(?, new_limit), tx_hash = COALESCE(?, tx_hash), note = COALESCE(?, note),
           decided_time = COALESCE(decided_time, ?), decided_by = COALESCE(decided_by, ?) WHERE id = ?`,
      ).run(
        p.status,
        p.newLimit ?? null,
        p.txHash ?? null,
        p.note ?? null,
        Math.floor(Date.now() / 1000),
        p.decidedBy ?? null,
        id.toLowerCase(),
      );
    },

    // ── Audit log (operator actions) ────────────────────────────────────────
    audit(p: { actor: string; action: string; account?: string; keyId?: string; detail: string; txHash?: string | null; ok: boolean }) {
      db.prepare(
        "INSERT INTO audit_log (time, actor, action, account, key_id, detail, tx_hash, ok) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        Math.floor(Date.now() / 1000),
        p.actor,
        p.action,
        p.account?.toLowerCase() ?? null,
        p.keyId?.toLowerCase() ?? null,
        p.detail,
        p.txHash ?? null,
        p.ok ? 1 : 0,
      );
    },
    listAudit(opts: { account?: string; keyId?: string; limit?: number } = {}): AuditRow[] {
      if (opts.account && opts.keyId) {
        return db
          .prepare("SELECT * FROM audit_log WHERE account = ? AND key_id = ? ORDER BY id DESC LIMIT ?")
          .all(opts.account.toLowerCase(), opts.keyId.toLowerCase(), opts.limit ?? 100) as AuditRow[];
      }
      return db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").all(opts.limit ?? 100) as AuditRow[];
    },

    // ── Alerts ──────────────────────────────────────────────────────────────
    /** Record that an alert was sent; returns false if already sent for this window. */
    markAlertSent(account: string, keyId: string, kind: string, window: string): boolean {
      const res = db
        .prepare("INSERT OR IGNORE INTO alerts_sent (account, key_id, kind, window, time) VALUES (?, ?, ?, ?, ?)")
        .run(account.toLowerCase(), keyId.toLowerCase(), kind, window, Math.floor(Date.now() / 1000));
      return res.changes > 0;
    },

    // ── Analytics ───────────────────────────────────────────────────────────
    /**
     * Best available estimate of a key's configured limit per token: the
     * latest SpendingLimitUpdated, or failing that the largest
     * remaining+amount observed on a spend (≈ the limit at period start).
     * Initial limits aren't evented on-chain, so this is an estimate.
     */
    limitEstimates(account: string, keyId: string): Map<string, bigint> {
      const acc = account.toLowerCase();
      const kid = keyId.toLowerCase();
      const updates = db
        .prepare(
          "SELECT token, new_limit, block_number FROM limit_updates WHERE account = ? AND key_id = ? ORDER BY block_number, log_index",
        )
        .all(acc, kid) as { token: string; new_limit: string; block_number: number }[];
      const lastUpdate = new Map<string, { limit: bigint; block: number }>();
      for (const u of updates) lastUpdate.set(u.token, { limit: BigInt(u.new_limit), block: u.block_number });

      const spends = db
        .prepare("SELECT token, amount, remaining, block_number FROM spends WHERE account = ? AND key_id = ?")
        .all(acc, kid) as { token: string; amount: string; remaining: string; block_number: number }[];
      const out = new Map<string, bigint>();
      for (const [token, u] of lastUpdate) out.set(token, u.limit);
      for (const r of spends) {
        const u = lastUpdate.get(r.token);
        // Spends before the latest limit update describe an older limit.
        if (u && r.block_number <= u.block) continue;
        const v = BigInt(r.amount) + BigInt(r.remaining);
        if (v > (out.get(r.token) ?? 0n)) out.set(r.token, v);
      }
      return out;
    },
    /** Daily spend totals (UTC days) for one key since `sinceUnix`, fees included. */
    dailySpend(account: string, keyId: string, sinceUnix: number): Map<string, bigint> {
      const rows = db
        .prepare("SELECT block_time, amount FROM spends WHERE account = ? AND key_id = ? AND block_time >= ?")
        .all(account.toLowerCase(), keyId.toLowerCase(), sinceUnix) as { block_time: number; amount: string }[];
      const out = new Map<string, bigint>();
      for (const r of rows) {
        const day = new Date(r.block_time * 1000).toISOString().slice(0, 10);
        out.set(day, (out.get(day) ?? 0n) + BigInt(r.amount));
      }
      return out;
    },
    /** Top recipients by payment volume for one key. */
    topRecipients(account: string, keyId: string, limit = 5): { to_addr: string; total: bigint; count: number }[] {
      const rows = db
        .prepare(
          `${CLASSIFIED_SPENDS}
           SELECT to_addr, amount FROM classified WHERE account = ? AND key_id = ? AND kind = 'payment' AND to_addr IS NOT NULL`,
        )
        .all(account.toLowerCase(), keyId.toLowerCase()) as { to_addr: string; amount: string }[];
      const agg = new Map<string, { total: bigint; count: number }>();
      for (const r of rows) {
        const e = agg.get(r.to_addr) ?? { total: 0n, count: 0 };
        e.total += BigInt(r.amount);
        e.count++;
        agg.set(r.to_addr, e);
      }
      return [...agg.entries()]
        .map(([to_addr, e]) => ({ to_addr, ...e }))
        .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0))
        .slice(0, limit);
    },

    listKeys(): KeyRow[] {
      return db
        .prepare("SELECT * FROM keys ORDER BY authorized_block DESC")
        .all() as KeyRow[];
    },
    /**
     * Spend feed: each AccessKeySpend joined with *one* same-transaction
     * TIP-20 transfer of the same token/amount (recipient + memo). A memo
     * transfer emits both `Transfer` and `TransferWithMemo`; the memo-bearing
     * one is preferred so each debit renders exactly once.
     */
    listPayments(
      opts: { limit?: number; account?: string; keyId?: string; memo?: string; txHash?: string } = {},
    ): PaymentRow[] {
      const { limit = 100 } = opts;
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (opts.account) {
        where.push("m.account = ?");
        params.push(opts.account.toLowerCase());
      }
      if (opts.keyId) {
        where.push("m.key_id = ?");
        params.push(opts.keyId.toLowerCase());
      }
      if (opts.memo) {
        where.push("lower(m.memo) = ?");
        params.push(opts.memo.toLowerCase());
      }
      if (opts.txHash) {
        where.push("m.tx_hash = ?");
        params.push(opts.txHash.toLowerCase());
      }
      params.push(limit);
      return db
        .prepare(
          `${CLASSIFIED_SPENDS}
           SELECT m.tx_hash, m.log_index, m.block_number, m.block_time, m.account, m.key_id,
                  m.token, m.amount, m.remaining, m.to_addr, m.memo, m.kind
           FROM classified m
           ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
           ORDER BY m.block_number DESC, m.log_index DESC
           LIMIT ?`,
        )
        .all(...params) as PaymentRow[];
    },
    spendTotals(): Map<string, bigint> {
      const rows = db
        .prepare("SELECT account, key_id, token, amount FROM spends")
        .all() as Pick<SpendRow, "account" | "key_id" | "token" | "amount">[];
      const totals = new Map<string, bigint>();
      for (const r of rows) {
        const k = `${r.account}|${r.key_id}|${r.token}`;
        totals.set(k, (totals.get(k) ?? 0n) + BigInt(r.amount));
      }
      return totals;
    },
    lastSpendTimes(): Map<string, number> {
      const rows = db
        .prepare(
          "SELECT account, key_id, MAX(block_time) AS t FROM spends GROUP BY account, key_id",
        )
        .all() as { account: string; key_id: string; t: number }[];
      return new Map(rows.map((r) => [`${r.account}|${r.key_id}`, r.t]));
    },
    /** Number of real payments (fee and other non-transfer debits excluded). */
    paymentCount(): number {
      const row = db
        .prepare(`${CLASSIFIED_SPENDS} SELECT COUNT(*) AS n FROM classified WHERE kind = 'payment'`)
        .get() as { n: number };
      return row.n;
    },
    keyEvents(limit = 200): KeyEventRow[] {
      return db
        .prepare(
          `SELECT * FROM (
             SELECT 'authorized' AS kind, authorized_time AS block_time, authorized_tx AS tx_hash,
                    account, key_id, NULL AS token, NULL AS new_limit, authorized_block AS block_number
             FROM keys
             UNION ALL
             SELECT 'revoked', k.revoked_time, k.revoked_tx, k.account, k.key_id, NULL, NULL, k.revoked_block
             FROM keys k WHERE k.revoked_block IS NOT NULL
             UNION ALL
             SELECT 'limit_updated', block_time, tx_hash, account, key_id, token, new_limit, block_number
             FROM limit_updates
           )
           ORDER BY block_number DESC LIMIT ?`,
        )
        .all(limit) as KeyEventRow[];
    },
  };
}

export type Db = ReturnType<typeof openDb>;
