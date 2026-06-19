const { contextBridge, ipcRenderer, webUtils } = require("electron");

let lastDroppedFilePaths = [];

window.addEventListener(
  "drop",
  (event) => {
    lastDroppedFilePaths = Array.from(event.dataTransfer?.files || [])
      .map((file) => {
        try {
          return webUtils.getPathForFile(file);
        } catch {
          return "";
        }
      })
      .filter(Boolean);

    console.log("[preload-sync-drop] captured paths:", lastDroppedFilePaths);
  },
  true
);

contextBridge.exposeInMainWorld("syncApi", {
  trackAttachment: (payload) =>
    ipcRenderer.invoke("sync:track-attachment", payload),

  getAttachment: (userId, attachmentId) =>
    ipcRenderer.invoke("sync:get-attachment", userId, attachmentId),

  listAttachments: (userId) =>
    ipcRenderer.invoke("sync:list-attachments", userId),

  selectFilesForSync: () => ipcRenderer.invoke("sync:select-files"),

  getDroppedFilePaths: () => lastDroppedFilePaths,

  listPendingUploads: (userId) =>
    ipcRenderer.invoke("sync:list-pending-uploads", userId),

  listDirtySyncInfo: (userId) =>
    ipcRenderer.invoke("sync:list-dirty-sync-info", userId),

  markSyncInfoClean: (attachmentId, userId) =>
    ipcRenderer.invoke("sync:mark-sync-info-clean", attachmentId, userId),

  readLocalFile: (localPath) =>
    ipcRenderer.invoke("sync:read-local-file", localPath),

  scanLocalChanges: (userId) =>
    ipcRenderer.invoke("sync:scan-local-changes", userId),

  refreshWatcher: (userId) =>
    ipcRenderer.invoke("sync:refresh-watcher", userId),

  getWatchedPaths: (userId) =>
    ipcRenderer.invoke("sync:get-watched-paths", userId),

  getDbWatchedPaths: (userId) =>
    ipcRenderer.invoke("sync:get-watched-paths", userId),

  disableAttachmentSync: (userId, attachmentId) =>
    ipcRenderer.invoke("sync:disable-attachment", userId, attachmentId),

  acquireLock: (userId) => ipcRenderer.invoke("sync:acquire-lock", userId),

  renewLock: (userId, lockToken) =>
    ipcRenderer.invoke("sync:renew-lock", userId, lockToken),

  releaseLock: (userId, lockToken) =>
    ipcRenderer.invoke("sync:release-lock", userId, lockToken),

  getCurrentLock: (userId) =>
    ipcRenderer.invoke("sync:get-current-lock", userId),
});
