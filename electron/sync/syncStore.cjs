const path = require("node:path");
const Database = require("better-sqlite3");
const { app } = require("electron");

const crypto = require("node:crypto");
const os = require("node:os");
const fs = require("node:fs");

let db = null;
let didLogDbInit = false;

console.log("[sync-store] loading syncStore.cjs");

function getDeviceIdPath() {
  return path.join(app.getPath("userData"), "device-id");
}

function getDeviceId() {
  const file = getDeviceIdPath();

  if (fs.existsSync(file)) {
    return fs.readFileSync(file, "utf8").trim();
  }

  const id = crypto.randomUUID();
  fs.writeFileSync(file, id, "utf8");
  return id;
}

function getDeviceName() {
  return os.hostname();
}

function getSyncStorePath() {
  return path.join(app.getPath("userData"), "sync-store.db");
}

function getDb() {
  if (!didLogDbInit) {
    console.log("[sync-store] initialized sqlite db:", getSyncStorePath());
    didLogDbInit = true;
  }

  if (db) return db;

  db = new Database(getSyncStorePath());

  db.pragma("journal_mode = WAL");

  db.exec(`
      CREATE TABLE IF NOT EXISTS synced_attachments (
        user_id TEXT NOT NULL,  
        attachment_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        device_name TEXT,
        local_path TEXT NOT NULL,

        last_synced_version INTEGER DEFAULT 1,
        last_synced_hash TEXT,

        sync_enabled INTEGER DEFAULT 1,

        last_seen_mtime REAL,
        last_seen_size INTEGER,

        sync_status TEXT DEFAULT 'synced',
        pending_upload INTEGER DEFAULT 0,

        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        PRIMARY KEY (user_id, attachment_id, device_id)
    );

    CREATE INDEX IF NOT EXISTS idx_synced_attachments_device_id
      ON synced_attachments(device_id);

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
    userId: String(payload.userId),
    attachmentId: String(payload.attachmentId),
    deviceId: payload.deviceId || getDeviceId(),
    deviceName: payload.deviceName || getDeviceName(),
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
        user_id,
        attachment_id,
        device_id,
        device_name,
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
        @userId,
        @attachmentId,
        @deviceId,
        @deviceName,
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
      ON CONFLICT(user_id, attachment_id, device_id) DO UPDATE SET
        device_name = excluded.device_name,
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

  return getSyncedAttachment(row.userId, row.attachmentId);
}

function mapRow(row) {
  if (!row) return null;

  return {
    userId: row.user_id,
    attachmentId: row.attachment_id,
    deviceId: row.device_id,
    deviceName: row.device_name,
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

function getSyncedAttachment(userId, attachmentId) {
  const row = getDb()
    .prepare(
      `
      SELECT *
      FROM synced_attachments
      WHERE user_id = ?
        AND attachment_id = ?
        AND device_id = ?
    `
    )
    .get(String(userId), String(attachmentId), getDeviceId());

  return mapRow(row);
}

function listSyncedAttachments(userId) {
  const rows = getDb()
    .prepare(
      `
      SELECT *
      FROM synced_attachments
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `
    )
    .all(String(userId));

  return rows.map(mapRow);
}

function disableAttachmentSync(userId, attachmentId) {
  getDb()
    .prepare(
      `
      UPDATE synced_attachments
      SET sync_enabled = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
        AND attachment_id = ?
        AND device_id = ?
    `
    )
    .run(String(userId), String(attachmentId), getDeviceId());

  return getSyncedAttachment(userId, attachmentId);
}

module.exports = {
  getSyncStorePath,
  upsertSyncedAttachment,
  getSyncedAttachment,
  listSyncedAttachments,
  disableAttachmentSync,
  getDeviceId,
  getDeviceName,
};
