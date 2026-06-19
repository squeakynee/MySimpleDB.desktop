import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from "electron";
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
  listDirtySyncInfo,
  disableAttachmentSync,
  getSyncStorePath,
  markSyncInfoClean,
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

function buildAppMenu() {
  const isMac = process.platform === "darwin";
  const isDev = !app.isPackaged;

  const template: any[] = [];

  if (isMac) {
    template.push({
      label: "MySimpleDB",
      submenu: [
        { role: "about", label: "About MySimpleDB" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide", label: "Hide MySimpleDB" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit", label: "Quit MySimpleDB" },
      ],
    });
  }

  template.push(
    {
      label: "File",
      submenu: [
        { label: "Refresh", accelerator: "CmdOrCtrl+R", role: "reload" },
        { type: "separator" },
        { role: "close", label: "Close Window" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(isDev ? [{ type: "separator" }, { role: "toggleDevTools" }] : []),
      ],
    },
    {
      label: "Window",
      submenu: isMac
        ? [
            { role: "minimize" },
            { role: "zoom" },
            { type: "separator" },
            { role: "front" },
          ]
        : [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "MySimpleDB Website",
          click: async () => shell.openExternal("https://mysimpledb.com"),
        },
        {
          label: "Privacy Policy",
          click: async () =>
            shell.openExternal("https://mysimpledb.com/privacy"),
        },
        {
          label: "Terms of Service",
          click: async () => shell.openExternal("https://mysimpledb.com/terms"),
        },
        {
          label: "SMS Opt-In",
          click: async () =>
            shell.openExternal("https://mysimpledb.com/sms-optin"),
        },
      ],
    }
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

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

function rememberLock(
  userId: string | number,
  lockToken: string | undefined | null
) {
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
      console.log(
        `[sync] released ${released} ${OWNER_APP} lock(s) during ${reason}`
      );
    }
    activeSyncLocks.clear();
  } catch (err) {
    console.error(
      `[sync] failed to release ${OWNER_APP} locks during ${reason}:`,
      err
    );
  }
}

function isActiveSyncOwner(userId: string | number): boolean {
  const lock = getCurrentLock({ userId });

  return !!lock && lock.owner_app === OWNER_APP;
}

app.whenReady().then(() => {
  console.log("[sync-store] initialized at:", getSyncStorePath());
  buildAppMenu();
  createWindow();
});

app.on("window-all-closed", () => {
  releaseOwnedLocks("window-all-closed");
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("sync:track-attachment", async (_event, payload) => {
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

ipcMain.handle("sync:list-dirty-sync-info", async (_event, userId) => {
  if (!isActiveSyncOwner(userId)) {
    return [];
  }

  return listDirtySyncInfo(userId);
});

ipcMain.handle(
  "sync:mark-sync-info-clean",
  async (_event, attachmentId, userId) => {
    if (!isActiveSyncOwner(userId)) {
      return {
        ok: false,
        skipped: true,
        reason: "not-lock-owner",
      };
    }

    return markSyncInfoClean(attachmentId, userId);
  }
);

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
