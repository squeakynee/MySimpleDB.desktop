const crypto = require("crypto");

const { getDb, getDeviceId } = require("./syncStore.cjs");

function nowMs() {
  return Date.now();
}

function acquireSyncLock({ userId, ownerApp, ttlMs = 30000 }) {
  const db = getDb();

  const deviceId = getDeviceId();
  const lockToken = crypto.randomUUID();
  const expiresAt = nowMs() + ttlMs;

  const existing = db
    .prepare(
      `
      SELECT *
      FROM sync_runtime_lock
      WHERE user_id = ?
        AND device_id = ?
    `
    )
    .get(String(userId), deviceId);

  if (existing && existing.expires_at > nowMs()) {
    return {
      acquired: false,
      existing,
    };
  }

  db.prepare(
    `
    INSERT OR REPLACE INTO sync_runtime_lock (
      user_id,
      device_id,
      owner_app,
      lock_token,
      expires_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `
  ).run(String(userId), deviceId, ownerApp, lockToken, expiresAt);

  return {
    acquired: true,
    lockToken,
    deviceId,
    expiresAt,
  };
}

function renewSyncLock({ userId, lockToken, ttlMs = 30000 }) {
  const db = getDb();

  const deviceId = getDeviceId();
  const expiresAt = nowMs() + ttlMs;

  const result = db
    .prepare(
      `
    UPDATE sync_runtime_lock
    SET expires_at = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
      AND device_id = ?
      AND lock_token = ?
  `
    )
    .run(expiresAt, String(userId), deviceId, lockToken);

  return result.changes > 0;
}

function releaseSyncLock({ userId, lockToken }) {
  const db = getDb();

  const deviceId = getDeviceId();

  const result = db
    .prepare(
      `
    DELETE FROM sync_runtime_lock
    WHERE user_id = ?
      AND device_id = ?
      AND lock_token = ?
  `
    )
    .run(String(userId), deviceId, lockToken);

  return result.changes > 0;
}

function getCurrentLock({ userId }) {
  const db = getDb();

  const deviceId = getDeviceId();

  return db
    .prepare(
      `
    SELECT *
    FROM sync_runtime_lock
    WHERE user_id = ?
      AND device_id = ?
  `
    )
    .get(String(userId), deviceId);
}

module.exports = {
  acquireSyncLock,
  renewSyncLock,
  releaseSyncLock,
  getCurrentLock,
};
