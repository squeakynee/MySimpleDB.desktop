const fs = require("node:fs");
const chokidar = require("chokidar");

let watcher = null;
let debounceTimers = new Map();
let watchedPathSet = new Set();

function getWatchableAttachments(listSyncedAttachments, userId) {
  return listSyncedAttachments(userId)
    .filter((item) => item.syncEnabled !== false)
    .filter((item) => item.localPath)
    .filter((item) => !String(item.localPath).startsWith("./"));
}

function startAttachmentWatcher({
  userId,
  listSyncedAttachments,
  upsertSyncedAttachment,
}) {
  if (watcher) {
    console.log("[sync-watch] watcher already running");
    return watcher;
  }

  const attachments = getWatchableAttachments(listSyncedAttachments, userId);
  const paths = attachments.map((item) => item.localPath);

  watchedPathSet = new Set(paths);

  if (paths.length === 0) {
    console.log("[sync-watch] no absolute synced files to watch");
    return null;
  }

  console.log("[sync-watch] watching files:", paths);

  watcher = chokidar.watch(paths, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 1500,
      pollInterval: 250,
    },
  });

  watcher.on("change", (filePath) => {
    clearTimeout(debounceTimers.get(filePath));

    debounceTimers.set(
      filePath,
      setTimeout(() => {
        handleLocalFileChange({
          userId,
          filePath,
          listSyncedAttachments,
          upsertSyncedAttachment,
        });
      }, 500)
    );
  });

  watcher.on("unlink", (filePath) => {
    console.warn("[sync-watch] local file missing:", filePath);
  });

  watcher.on("error", (err) => {
    console.error("[sync-watch] watcher error:", err);
  });

  return watcher;
}

function refreshAttachmentWatcher({
  userId,
  listSyncedAttachments,
  upsertSyncedAttachment,
}) {
  const attachments = getWatchableAttachments(listSyncedAttachments, userId);
  const desiredPaths = attachments.map((item) => item.localPath);
  const desiredSet = new Set(desiredPaths);

  if (!watcher) {
    console.log("[sync-watch] refresh starting watcher");
    return startAttachmentWatcher({
      userId,
      listSyncedAttachments,
      upsertSyncedAttachment,
    });
  }

  const pathsToAdd = desiredPaths.filter((p) => !watchedPathSet.has(p));
  const pathsToRemove = [...watchedPathSet].filter((p) => !desiredSet.has(p));

  if (pathsToRemove.length > 0) {
    watcher.unwatch(pathsToRemove);
    pathsToRemove.forEach((p) => watchedPathSet.delete(p));
    console.log("[sync-watch] removed files:", pathsToRemove);
  }

  if (pathsToAdd.length > 0) {
    watcher.add(pathsToAdd);
    pathsToAdd.forEach((p) => watchedPathSet.add(p));
    console.log("[sync-watch] added files:", pathsToAdd);
  }

  if (pathsToAdd.length === 0 && pathsToRemove.length === 0) {
    console.log("[sync-watch] refresh no changes");
  }

  return watcher;
}

function getWatchedPaths(userId) {
  return [...watchedPathSet];
}

function handleLocalFileChange({
  userId,
  filePath,
  listSyncedAttachments,
  upsertSyncedAttachment,
}) {
  const attachments = listSyncedAttachments(userId);

  const attachment = attachments.find((item) => item.localPath === filePath);

  if (!attachment) {
    console.warn("[sync-watch] changed file not tracked:", filePath);
    return;
  }

  let stat;

  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    console.error("[sync-watch] unable to stat changed file:", filePath, err);
    return;
  }

  const currentMtime = stat.mtimeMs;
  const currentSize = stat.size;

  const previousMtime = Number(attachment.lastSeenMtime || 0);
  const previousSize = Number(attachment.lastSeenSize || 0);

  if (currentMtime === previousMtime && currentSize === previousSize) {
    return;
  }

  console.log("[sync-watch] local file modified:", {
    attachmentId: attachment.attachmentId,
    filePath,
    previousMtime,
    currentMtime,
    previousSize,
    currentSize,
  });

  upsertSyncedAttachment({
    ...attachment,
    syncStatus: "modified-local",
    pendingUpload: true,
  });
}

function stopAttachmentWatcher() {
  if (!watcher) return;

  watcher.close();
  watcher = null;
  debounceTimers.clear();
  watchedPathSet = new Set();

  console.log("[sync-watch] stopped");
}

module.exports = {
  startAttachmentWatcher,
  refreshAttachmentWatcher,
  stopAttachmentWatcher,
  getWatchedPaths,
};
