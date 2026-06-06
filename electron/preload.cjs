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

  refreshWatcher: (userId) =>
    ipcRenderer.invoke("sync:refresh-watcher", userId),

  getWatchedPaths: () => ipcRenderer.invoke("sync:get-watched-paths"),

  disableAttachmentSync: (userId, attachmentId) =>
    ipcRenderer.invoke("sync:disable-attachment", userId, attachmentId),
});

window.__lastElectronDroppedFiles = [];

window.addEventListener("drop", (event) => {
  const files = Array.from(event.dataTransfer?.files || []);

  window.__lastElectronDroppedFiles = files
    .map((file) => file.path)
    .filter(Boolean);
});
