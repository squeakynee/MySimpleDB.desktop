const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("syncApi", {
  trackAttachment: (payload) =>
    ipcRenderer.invoke("sync:track-attachment", payload),

  getAttachment: (attachmentId) =>
    ipcRenderer.invoke("sync:get-attachment", attachmentId),

  listAttachments: () => ipcRenderer.invoke("sync:list-attachments"),

  selectFilesForSync: () => ipcRenderer.invoke("sync:select-files"),

  disableAttachment: (attachmentId) =>
    ipcRenderer.invoke("sync:disable-attachment", attachmentId),

  getDroppedFilePaths: () => {
    return window.__lastElectronDroppedFiles || [];
  },

  listPendingUploads: () => ipcRenderer.invoke("sync:list-pending-uploads"),

  readLocalFile: (localPath) =>
    ipcRenderer.invoke("sync:read-local-file", localPath),

  refreshWatcher: () => ipcRenderer.invoke("sync:refresh-watcher"),

  getWatchedPaths: () => ipcRenderer.invoke("sync:get-watched-paths"),
});

window.__lastElectronDroppedFiles = [];

window.addEventListener("drop", (event) => {
  const files = Array.from(event.dataTransfer?.files || []);

  window.__lastElectronDroppedFiles = files
    .map((file) => file.path)
    .filter(Boolean);

  console.log(
    "[electron-drop] captured paths:",
    window.__lastElectronDroppedFiles
  );
});

console.log("[preload] syncApi exposed");
