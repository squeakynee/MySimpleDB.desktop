const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("syncApi", {
  trackAttachment: (payload) =>
    ipcRenderer.invoke("sync:track-attachment", payload),

  getAttachment: (userId, attachmentId) =>
    ipcRenderer.invoke("sync:get-attachment", userId, attachmentId),

  listAttachments: (userId) =>
    ipcRenderer.invoke("sync:list-attachments", userId),

  selectFilesForSync: () => ipcRenderer.invoke("sync:select-files"),

  getDroppedFilePaths: () => {
    return window.__lastElectronDroppedFiles || [];
  },

  listPendingUploads: (userId) =>
    ipcRenderer.invoke("sync:list-pending-uploads", userId),

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

window.__lastElectronDroppedFiles = [];

window.addEventListener("drop", (event) => {
  const files = Array.from(event.dataTransfer?.files || []);

  window.__lastElectronDroppedFiles = files
    .map((file) => file.path)
    .filter(Boolean);
});
