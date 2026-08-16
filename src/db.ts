import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

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

/** A spend joined with the same-transaction token transfer (recipient + memo). */
export interface PaymentRow extends SpendRow {
  to_addr: string | null;
  memo: string | null;
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
  `);

  const stmts = {
    getCursor: db.prepare("SELECT last_block FROM cursor WHERE id = 1"),
    setCursor: db.prepare(
      "INSERT INTO cursor (id, last_block) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET last_block = excluded.last_block",
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
  };

  return {
    raw: db,

    getCursor(): bigint | null {
      const row = stmts.getCursor.get() as { last_block: number } | undefined;
      return row ? BigInt(row.last_block) : null;
    },
    setCursor(block: bigint) {
      stmts.setCursor.run(Number(block));
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

    listKeys(): KeyRow[] {
      return db
        .prepare("SELECT * FROM keys ORDER BY authorized_block DESC")
        .all() as KeyRow[];
    },
    /**
     * Spend feed: each AccessKeySpend joined with the same-transaction
     * TIP-20 transfer of the same token/amount (recipient + memo).
     */
    listPayments(limit = 100): PaymentRow[] {
      return db
        .prepare(
          `SELECT s.*, t.to_addr, t.memo
           FROM spends s
           LEFT JOIN transfers t
             ON t.tx_hash = s.tx_hash AND t.token = s.token AND t.amount = s.amount
           ORDER BY s.block_number DESC, s.log_index DESC
           LIMIT ?`,
        )
        .all(limit) as PaymentRow[];
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
    paymentCount(): number {
      const row = db.prepare("SELECT COUNT(*) AS n FROM spends").get() as { n: number };
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
