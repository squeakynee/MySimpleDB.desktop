import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OWNER_APP = "desktop";

const {
  refreshAttachmentWatcher,
  stopAttachmentWatcher,
  getDbWatchedPaths,
  scanLocalFilesForChanges,
} = require("./sync/fileWatcher.cjs");

const {
  upsertSyncedAttachment,
  getSyncedAttachment,
  listSyncedAttachments,
  disableAttachmentSync,
  getSyncStorePath,
} = require("./sync/syncStore.cjs");

const {
  acquireSyncLock,
  renewSyncLock,
  releaseSyncLock,
  releaseSyncLocksForOwner,
  getCurrentLock,
} = require("./sync/syncLock.cjs");

let win: BrowserWindow | null = null;
const activeSyncLocks = new Map<string, string>();
let isQuitting = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadURL("https://mysimpledb.com");
  // win.loadURL("http://localhost:3000");

  win.webContents.openDevTools({ mode: "undocked" });
}


function rememberLock(userId: string | number, lockToken: string | undefined | null) {
  if (!lockToken) return;
  activeSyncLocks.set(String(userId), lockToken);
}

function forgetLock(userId: string | number, lockToken?: string | null) {
  const key = String(userId);
  if (!lockToken || activeSyncLocks.get(key) === lockToken) {
    activeSyncLocks.delete(key);
  }
}

function releaseOwnedLocks(reason: string) {
  try {
    stopAttachmentWatcher();
  } catch (err) {
    console.warn(`[sync] stop watcher ignored during ${reason}:`, err);
  }

  try {
    const released = releaseSyncLocksForOwner({ ownerApp: OWNER_APP });
    if (released) {
      console.log(`[sync] released ${released} ${OWNER_APP} lock(s) during ${reason}`);
    }
    activeSyncLocks.clear();
  } catch (err) {
    console.error(`[sync] failed to release ${OWNER_APP} locks during ${reason}:`, err);
  }
}

function isActiveSyncOwner(userId: string | number): boolean {
  const lock = getCurrentLock({ userId });

  return !!lock && lock.owner_app === OWNER_APP;
}

app.whenReady().then(() => {
  console.log("[sync-store] initialized at:", getSyncStorePath());
  createWindow();
});

app.on("window-all-closed", () => {
  releaseOwnedLocks("window-all-closed");
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("sync:track-attachment", async (_event, payload) => {
  const userId = payload?.userId;

  if (!isActiveSyncOwner(userId)) {
    console.log("[sync] skipping track-attachment; desktop is not lock owner", {
      userId,
      lock: getCurrentLock({ userId }),
    });

    return {
      ok: false,
      skipped: true,
      reason: "not-lock-owner",
      before: [],
      after: [],
    };
  }

  return upsertSyncedAttachment(payload);
});

ipcMain.handle("sync:get-attachment", async (_event, userId, attachmentId) => {
  return getSyncedAttachment(userId, attachmentId);
});

ipcMain.handle("sync:list-attachments", async (_event, userId) => {
  return listSyncedAttachments(userId);
});

ipcMain.handle(
  "sync:disable-attachment",
  async (_event, userId, attachmentId) => {
    return disableAttachmentSync(userId, attachmentId);
  }
);

ipcMain.handle("sync:select-files", async () => {
  const result = await dialog.showOpenDialog(win!, {
    title: "Select files to sync",
    properties: ["openFile", "multiSelections"],
  });

  if (result.canceled) return [];

  return result.filePaths.map((filePath) => {
    const buffer = fs.readFileSync(filePath);
    const stat = fs.statSync(filePath);

    return {
      localPath: filePath,
      name: path.basename(filePath),
      size: stat.size,
      lastModified: stat.mtimeMs,
      dataBase64: buffer.toString("base64"),
    };
  });
});

ipcMain.handle("sync:list-pending-uploads", async (_event, userId) => {
  if (!isActiveSyncOwner(userId)) {
    console.log(
      "[sync] skipping list-pending-uploads; desktop is not lock owner",
      {
        userId,
        lock: getCurrentLock({ userId }),
      }
    );

    return [];
  }

  return listSyncedAttachments(userId).filter(
    (item: any) => item.pendingUpload === true && item.syncEnabled !== false
  );
});

ipcMain.handle("sync:read-local-file", async (_event, localPath) => {
  const buffer = fs.readFileSync(localPath);
  const stat = fs.statSync(localPath);

  return {
    localPath,
    name: path.basename(localPath),
    size: stat.size,
    lastModified: stat.mtimeMs,
    dataBase64: buffer.toString("base64"),
  };
});

/**
 * Desktop recovery scan.
 *
 * This is intentionally active only in Desktop. It scans synced local files
 * for changes that happened while the app was closed/asleep/offline and marks
 * changed files as pending_upload=1 + sync_status='modified-local'.
 */
ipcMain.handle("sync:scan-local-changes", async (_event, userId) => {
  if (!isActiveSyncOwner(userId)) {
    console.log(
      "[sync] skipping scan-local-changes; desktop is not lock owner",
      {
        userId,
        lock: getCurrentLock({ userId }),
      }
    );

    return {
      ok: false,
      skipped: true,
      reason: "not-lock-owner",
    };
  }

  return scanLocalFilesForChanges({
    userId,
    listSyncedAttachments,
    upsertSyncedAttachment,
  });
});

ipcMain.handle("sync:refresh-watcher", async (_event, userId) => {
  if (!isActiveSyncOwner(userId)) {
    console.log("[sync] skipping refresh-watcher; desktop is not lock owner", {
      userId,
      lock: getCurrentLock({ userId }),
    });

    return {
      ok: false,
      skipped: true,
      reason: "not-lock-owner",
      before: [],
      after: [],
    };
  }

  const before = getDbWatchedPaths(listSyncedAttachments, userId);

  const recovery = scanLocalFilesForChanges({
    userId,
    listSyncedAttachments,
    upsertSyncedAttachment,
  });

  refreshAttachmentWatcher({
    userId,
    listSyncedAttachments,
    upsertSyncedAttachment,
  });

  const after = getDbWatchedPaths(listSyncedAttachments, userId);

  return { ok: true, before, after, recovery };
});

ipcMain.handle("sync:get-watched-paths", async (_event, userId) => {
  return getDbWatchedPaths(listSyncedAttachments, userId);
});

ipcMain.handle("sync:acquire-lock", async (_event, userId) => {
  const result = acquireSyncLock({
    userId,
    ownerApp: OWNER_APP,
  });

  if (result?.acquired) {
    rememberLock(userId, result.lockToken);
  }

  return result;
});

ipcMain.handle("sync:renew-lock", async (_event, userId, lockToken) => {
  const ok = renewSyncLock({
    userId,
    lockToken,
  });

  if (ok) {
    rememberLock(userId, lockToken);
  } else {
    forgetLock(userId, lockToken);
  }

  return ok;
});

ipcMain.handle("sync:release-lock", async (_event, userId, lockToken) => {
  const ok = releaseSyncLock({
    userId,
    lockToken,
  });

  if (ok) {
    forgetLock(userId, lockToken);
  }

  return ok;
});

ipcMain.handle("sync:get-current-lock", async (_event, userId) => {
  return getCurrentLock({ userId });
});

app.on("render-process-gone", (_, details) => {
  console.error("Renderer crashed", details);
});

app.on("before-quit", () => {
  if (!isQuitting) {
    isQuitting = true;
    releaseOwnedLocks("before-quit");
  }

  BrowserWindow.getAllWindows().forEach((win) => {
    win.setIgnoreMouseEvents(false);
  });
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});
