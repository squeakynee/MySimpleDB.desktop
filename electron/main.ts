import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  refreshAttachmentWatcher,
  stopAttachmentWatcher,
  getWatchedPaths,
} = require("./sync/fileWatcher.cjs");

const {
  upsertSyncedAttachment,
  getSyncedAttachment,
  listSyncedAttachments,
  disableAttachmentSync,
  getSyncStorePath,
} = require("./sync/syncStore.cjs");

let win: BrowserWindow | null = null;

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
  //win.loadURL("http://localhost:3000");

  win.webContents.openDevTools({ mode: "undocked" });
}

app.whenReady().then(() => {
  console.log("[sync-store] initialized at:", getSyncStorePath());

  createWindow();
});

app.on("window-all-closed", () => {
  stopAttachmentWatcher();

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

ipcMain.handle("sync:refresh-watcher", async (_event, userId) => {
  const before = getWatchedPaths();

  refreshAttachmentWatcher({
    userId,
    listSyncedAttachments,
    upsertSyncedAttachment,
  });

  const after = getWatchedPaths();

  return { ok: true, before, after };
});

ipcMain.handle("sync:get-watched-paths", async () => {
  return getWatchedPaths();
});
