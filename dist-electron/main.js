import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { upsertSyncedAttachment, getSyncedAttachment, listSyncedAttachments, disableAttachmentSync, getSyncStorePath, } = require("./sync/syncStore.cjs");
let win = null;
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
    //win.loadURL("https://mysimpledb.com");
    win.loadURL("http://localhost:3000");
    win.webContents.openDevTools({ mode: "undocked" });
}
app.whenReady().then(() => {
    console.log("[sync-store] initialized at:", getSyncStorePath());
    createWindow();
});
app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        app.quit();
});
ipcMain.handle("sync:track-attachment", async (_event, payload) => {
    return upsertSyncedAttachment(payload);
});
ipcMain.handle("sync:get-attachment", async (_event, attachmentId) => {
    return getSyncedAttachment(attachmentId);
});
ipcMain.handle("sync:list-attachments", async () => {
    return listSyncedAttachments();
});
ipcMain.handle("sync:disable-attachment", async (_event, attachmentId) => {
    return disableAttachmentSync(attachmentId);
});
