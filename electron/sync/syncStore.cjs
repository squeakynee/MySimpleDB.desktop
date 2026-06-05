const path = require("node:path");
const Database = require("better-sqlite3");
const { app } = require("electron");

let db = null;

console.log("[sync-store] loading syncStore.cjs");

function getSyncStorePath() {
  return path.join(app.getPath("userData"), "sync-store.db");
}

function getDb() {
  console.log("[sync-store] initializing sqlite db");
  console.log("[sync-store] db path:", getSyncStorePath());

  if (db) return db;

  db = new Database(getSyncStorePath());

  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS synced_attachments (
      attachment_id TEXT PRIMARY KEY,
      local_path TEXT NOT NULL,
      last_synced_version INTEGER DEFAULT 1,
      last_synced_hash TEXT,
      sync_enabled INTEGER DEFAULT 1,
      last_seen_mtime REAL,
      last_seen_size INTEGER,
      sync_status TEXT DEFAULT 'synced',
      pending_upload INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_synced_attachments_sync_enabled
      ON synced_attachments(sync_enabled);

    CREATE INDEX IF NOT EXISTS idx_synced_attachments_pending_upload
      ON synced_attachments(pending_upload);

    CREATE INDEX IF NOT EXISTS idx_synced_attachments_local_path
      ON synced_attachments(local_path);
  `);

  console.log("[sync-store] schema initialized");

  return db;
}

function upsertSyncedAttachment(payload) {
  const database = getDb();

  const row = {
    attachmentId: String(payload.attachmentId),
    localPath: payload.localPath,
    lastSyncedVersion: payload.lastSyncedVersion ?? 1,
    lastSyncedHash: payload.lastSyncedHash ?? null,
    syncEnabled: payload.syncEnabled === false ? 0 : 1,
    lastSeenMtime: payload.lastSeenMtime ?? null,
    lastSeenSize: payload.lastSeenSize ?? null,
    syncStatus: payload.syncStatus ?? "synced",
    pendingUpload: payload.pendingUpload ? 1 : 0,
  };

  database
    .prepare(
      `
      INSERT INTO synced_attachments (
        attachment_id,
        local_path,
        last_synced_version,
        last_synced_hash,
        sync_enabled,
        last_seen_mtime,
        last_seen_size,
        sync_status,
        pending_upload,
        created_at,
        updated_at
      )
      VALUES (
        @attachmentId,
        @localPath,
        @lastSyncedVersion,
        @lastSyncedHash,
        @syncEnabled,
        @lastSeenMtime,
        @lastSeenSize,
        @syncStatus,
        @pendingUpload,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT(attachment_id) DO UPDATE SET
        local_path = excluded.local_path,
        last_synced_version = excluded.last_synced_version,
        last_synced_hash = excluded.last_synced_hash,
        sync_enabled = excluded.sync_enabled,
        last_seen_mtime = excluded.last_seen_mtime,
        last_seen_size = excluded.last_seen_size,
        sync_status = excluded.sync_status,
        pending_upload = excluded.pending_upload,
        updated_at = CURRENT_TIMESTAMP
    `
    )
    .run(row);

  return getSyncedAttachment(row.attachmentId);
}

function mapRow(row) {
  if (!row) return null;

  return {
    attachmentId: row.attachment_id,
    localPath: row.local_path,
    lastSyncedVersion: row.last_synced_version,
    lastSyncedHash: row.last_synced_hash,
    syncEnabled: Boolean(row.sync_enabled),
    lastSeenMtime: row.last_seen_mtime,
    lastSeenSize: row.last_seen_size,
    syncStatus: row.sync_status,
    pendingUpload: Boolean(row.pending_upload),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getSyncedAttachment(attachmentId) {
  const row = getDb()
    .prepare(
      `
      SELECT *
      FROM synced_attachments
      WHERE attachment_id = ?
    `
    )
    .get(String(attachmentId));

  return mapRow(row);
}

function listSyncedAttachments() {
  return getDb()
    .prepare(
      `
      SELECT *
      FROM synced_attachments
      ORDER BY updated_at DESC
    `
    )
    .all()
    .map(mapRow);
}

function disableAttachmentSync(attachmentId) {
  getDb()
    .prepare(
      `
      UPDATE synced_attachments
      SET sync_enabled = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE attachment_id = ?
    `
    )
    .run(String(attachmentId));

  return getSyncedAttachment(attachmentId);
}

module.exports = {
  getSyncStorePath,
  upsertSyncedAttachment,
  getSyncedAttachment,
  listSyncedAttachments,
  disableAttachmentSync,
};
