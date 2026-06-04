const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('syncApi', {
  trackAttachment: (payload) =>
    ipcRenderer.invoke('sync:track-attachment', payload),

  getAttachment: (attachmentId) =>
    ipcRenderer.invoke('sync:get-attachment', attachmentId),

  listAttachments: () =>
    ipcRenderer.invoke('sync:list-attachments'),

  disableAttachment: (attachmentId) =>
    ipcRenderer.invoke('sync:disable-attachment', attachmentId),
});

console.log('[preload] syncApi exposed');
