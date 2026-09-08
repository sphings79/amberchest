import type BetterSqlite3 from 'better-sqlite3';

/**
 * Schema migrations, applied in order. `user_version` tracks how far we got.
 *
 * The database is a rebuildable index: everything in here can be reconstructed
 * from the .eml files and the per folder journal, so a migration is always
 * allowed to be destructive if that ever becomes necessary.
 */
const MIGRATIONS: string[] = [
  // 1 - initial schema
  `
  CREATE TABLE folders (
    id            INTEGER PRIMARY KEY,
    account_id    TEXT    NOT NULL,
    path          TEXT    NOT NULL,
    local_path    TEXT    NOT NULL,
    delimiter     TEXT    NOT NULL DEFAULT '',
    special_use   TEXT,
    no_select     INTEGER NOT NULL DEFAULT 0,
    uidvalidity   INTEGER,
    uidnext       INTEGER,
    selected      INTEGER NOT NULL DEFAULT 0,
    first_seen    TEXT    NOT NULL,
    last_sync     TEXT,
    UNIQUE (account_id, path)
  );

  CREATE TABLE messages (
    id            INTEGER PRIMARY KEY,
    account_id    TEXT    NOT NULL,
    folder_id     INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    uid           INTEGER NOT NULL,
    uidvalidity   INTEGER NOT NULL,
    message_id    TEXT,
    fingerprint   TEXT    NOT NULL,
    internal_date TEXT    NOT NULL,
    size          INTEGER NOT NULL DEFAULT 0,
    subject       TEXT,
    from_addr     TEXT,
    to_addr       TEXT,
    flags         TEXT    NOT NULL DEFAULT '[]',
    file_name     TEXT    NOT NULL,
    state         TEXT    NOT NULL DEFAULT 'active',
    deleted_at    TEXT,
    created_at    TEXT    NOT NULL
  );

  CREATE UNIQUE INDEX idx_messages_uid_active
    ON messages (account_id, folder_id, uidvalidity, uid)
    WHERE state = 'active';
  CREATE INDEX idx_messages_fingerprint ON messages (account_id, fingerprint);
  CREATE INDEX idx_messages_folder_state ON messages (folder_id, state);
  CREATE INDEX idx_messages_message_id ON messages (account_id, message_id);
  CREATE INDEX idx_messages_deleted_at ON messages (account_id, deleted_at);

  CREATE TABLE sync_runs (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    status      TEXT NOT NULL,
    stats       TEXT NOT NULL DEFAULT '{}',
    error       TEXT
  );

  CREATE INDEX idx_sync_runs_account ON sync_runs (account_id, started_at DESC);
  `,

  // 2 - attachment export
  `
  CREATE TABLE attachments (
    id            INTEGER PRIMARY KEY,
    account_id    TEXT    NOT NULL,
    message_id    INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    original_name TEXT    NOT NULL,
    content_type  TEXT,
    size          INTEGER NOT NULL DEFAULT 0,
    sha256        TEXT    NOT NULL,
    inline        INTEGER NOT NULL DEFAULT 0,
    /* Path of the written file, relative to the export target directory. */
    export_path   TEXT    NOT NULL,
    /* Set when this attachment reused an identical file that already existed. */
    deduplicated  INTEGER NOT NULL DEFAULT 0,
    exported_at   TEXT    NOT NULL
  );

  CREATE INDEX idx_attachments_account ON attachments (account_id);
  CREATE INDEX idx_attachments_message ON attachments (message_id);
  CREATE INDEX idx_attachments_sha ON attachments (account_id, sha256);
  CREATE UNIQUE INDEX idx_attachments_unique
    ON attachments (account_id, message_id, original_name, sha256);

  CREATE TABLE export_runs (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    status      TEXT NOT NULL,
    stats       TEXT NOT NULL DEFAULT '{}',
    error       TEXT
  );

  CREATE INDEX idx_export_runs_account ON export_runs (account_id, started_at DESC);
  `,

  // 3 - full text search
  `
  /*
   * External content table: FTS keeps only the index, the text lives here.
   * The body column holds the extracted plain text of the message, filled by
   * the indexer; the other columns mirror the message row.
   */
  CREATE TABLE message_text (
    message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    account_id TEXT    NOT NULL,
    subject    TEXT,
    from_addr  TEXT,
    to_addr    TEXT,
    body       TEXT,
    /* Concatenated text of the attachments, when that option is enabled. */
    attachment_text TEXT,
    indexed_at TEXT    NOT NULL
  );

  CREATE INDEX idx_message_text_account ON message_text (account_id);

  CREATE VIRTUAL TABLE message_fts USING fts5(
    subject,
    from_addr,
    to_addr,
    body,
    attachment_text,
    content = 'message_text',
    content_rowid = 'message_id',
    tokenize = 'unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER message_text_ai AFTER INSERT ON message_text BEGIN
    INSERT INTO message_fts (rowid, subject, from_addr, to_addr, body, attachment_text)
    VALUES (new.message_id, new.subject, new.from_addr, new.to_addr, new.body, new.attachment_text);
  END;

  CREATE TRIGGER message_text_ad AFTER DELETE ON message_text BEGIN
    INSERT INTO message_fts (message_fts, rowid, subject, from_addr, to_addr, body, attachment_text)
    VALUES ('delete', old.message_id, old.subject, old.from_addr, old.to_addr, old.body, old.attachment_text);
  END;

  CREATE TRIGGER message_text_au AFTER UPDATE ON message_text BEGIN
    INSERT INTO message_fts (message_fts, rowid, subject, from_addr, to_addr, body, attachment_text)
    VALUES ('delete', old.message_id, old.subject, old.from_addr, old.to_addr, old.body, old.attachment_text);
    INSERT INTO message_fts (rowid, subject, from_addr, to_addr, body, attachment_text)
    VALUES (new.message_id, new.subject, new.from_addr, new.to_addr, new.body, new.attachment_text);
  END;

  CREATE TABLE index_runs (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    status      TEXT NOT NULL,
    stats       TEXT NOT NULL DEFAULT '{}',
    error       TEXT
  );
  `,

  // 7 - archive verification
  `
  /*
   * Checksum of the message as it came off the server, not of the file on
   * disk: the file changes when the archive is encrypted or decrypted, the
   * message does not.
   */
  ALTER TABLE messages ADD COLUMN sha256 TEXT;

  CREATE TABLE verify_runs (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    status      TEXT NOT NULL,
    stats       TEXT NOT NULL DEFAULT '{}',
    /* The findings, capped, so one broken disk cannot fill the database. */
    findings    TEXT NOT NULL DEFAULT '[]',
    error       TEXT
  );

  CREATE INDEX idx_verify_runs_account ON verify_runs (account_id, started_at DESC);
  `,
];

export function migrate(db: BetterSqlite3.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let version = current; version < MIGRATIONS.length; version += 1) {
    const sql = MIGRATIONS[version];
    if (!sql) continue;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.pragma(`user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

export const SCHEMA_VERSION = MIGRATIONS.length;
