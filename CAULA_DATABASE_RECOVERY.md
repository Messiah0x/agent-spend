# Caula database durability and recovery

## Current deployment safety

- The original Railway production service uses a local SQLite database. **Do not apply the existing staged Railway volume and DB_PATH changes until its existing database has been exported and verified.** Mounting a new volume over the data directory can hide the old database, and changing DB_PATH to a new path creates a blank database.
- The separate caula-preview service currently uses `/tmp/caula-preview.db`. It is **ephemeral** and is safe only for testnet demonstrations. Do not treat its requests, labels, or audit history as durable.
- On-chain authorizations, payments and limit changes can be indexed again from the chain. Signed budget requests, reasons, human decisions, labels, and local audit records cannot all be reconstructed from on-chain events.

## Backup command

```sh
npm run db:backup -- /data/agent-spend.db /backups
```

The command creates a timestamped `caula-*.db` file using SQLite's online backup API and verifies it with `PRAGMA integrity_check`. It fails rather than silently opening a missing source database.

**Important:** `/backups` must be backed by an independent durable destination (or exported immediately to independent object storage). A backup on the same Railway volume is not disaster recovery. Do not expose backup files through a public web endpoint: they contain signed requests, reasons, and operator audit history.

## Safe production migration checklist

1. Arrange a private, authenticated export path or controlled one-off maintenance job that can read the **current** live SQLite database; never print database contents or credentials into CI logs.
2. Create a consistent snapshot with the backup command. Copy it to independent private storage and confirm its checksum and integrity. Test restoring it into an isolated instance and compare counts of approvals, reasons, audit rows, and indexed payments.
3. Plan a short write freeze so that new agent requests and admin decisions cannot be lost during the final copy. On-chain transfers remain independently enforced by Tempo.
4. Copy the verified database to the new volume's intended `DB_PATH`, ensure correct ownership, then start the application using that path. Verify counts, cursor, approvals, and read-only dashboard pages before allowing writes.
5. Set up scheduled off-volume encrypted backups, retention, and a restore drill. Alert on backup failures. Do not consider a volume alone to be a backup.

## Preview

Use a **separate** persistent volume if durable preview state is required. Do not share a volume with production, and do not commit the production environment's staged patch merely to persist preview state.
