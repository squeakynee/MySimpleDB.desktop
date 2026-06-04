const fs = require("fs");
const path = require("path");
const { app } = require("electron");

function getSyncStorePath() {
  return path.join(app.getPath("userData"), "mysimpledb-sync.json");
}

function readStore() {
  const file = getSyncStorePath();

  if (!fs.existsSync(file)) {
    return { synced_attachments: [] };
  }

  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeStore(store) {
  fs.writeFileSync(getSyncStorePath(), JSON.stringify(store, null, 2));
}

function upsertSyncedAttachment(payload) {
  const store = readStore();
  const rows = store.synced_attachments;

  const existingIndex = rows.findIndex(
    (row) => row.attachmentId === payload.attachmentId
  );

  const row = {
    ...payload,
    updatedAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    rows[existingIndex] = {
      ...rows[existingIndex],
      ...row,
    };
  } else {
    rows.push({
      ...row,
      createdAt: new Date().toISOString(),
    });
  }

  writeStore(store);
  return row;
}

function getSyncedAttachment(attachmentId) {
  const store = readStore();
  return store.synced_attachments.find(
    (row) => row.attachmentId === attachmentId
  );
}

function listSyncedAttachments() {
  const store = readStore();
  return store.synced_attachments;
}

function disableAttachmentSync(attachmentId) {
  const store = readStore();

  const row = store.synced_attachments.find(
    (row) => row.attachmentId === attachmentId
  );

  if (row) {
    row.syncEnabled = false;
    row.updatedAt = new Date().toISOString();
    writeStore(store);
  }

  return row || null;
}

module.exports = {
  getSyncStorePath,
  upsertSyncedAttachment,
  getSyncedAttachment,
  listSyncedAttachments,
  disableAttachmentSync,
};
