const fs = require("node:fs");
const chokidar = require("chokidar");

let watcher = null;
let debounceTimers = new Map();

function getWatchableAttachments(listSyncedAttachments) {
  return listSyncedAttachments()
    .filter((item) => item.syncEnabled !== false)
    .filter((item) => item.localPath)
    .filter((item) => !String(item.localPath).startsWith("./"));
}

function startAttachmentWatcher({
  listSyncedAttachments,
  upsertSyncedAttachment,
}) {
  if (watcher) {
    console.log("[sync-watch] watcher already running");
    return watcher;
  }

  const attachments = getWatchableAttachments(listSyncedAttachments);
  const paths = attachments.map((item) => item.localPath);

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
  listSyncedAttachments,
  upsertSyncedAttachment,
}) {
  const attachments = getWatchableAttachments(listSyncedAttachments);
  const paths = attachments.map((item) => item.localPath);

  if (!watcher) {
    console.log("[sync-watch] refresh starting watcher");
    return startAttachmentWatcher({
      listSyncedAttachments,
      upsertSyncedAttachment,
    });
  }

  const watched = watcher.getWatched();
  const watchedPaths = new Set();

  Object.entries(watched).forEach(([dir, files]) => {
    files.forEach((file) => {
      watchedPaths.add(`${dir}/${file}`);
    });
  });

  const newPaths = paths.filter((filePath) => !watchedPaths.has(filePath));

  if (newPaths.length === 0) {
    console.log("[sync-watch] refresh no new files");
    return watcher;
  }

  watcher.add(newPaths);

  console.log("[sync-watch] added files:", newPaths);

  return watcher;
}

function handleLocalFileChange({
  filePath,
  listSyncedAttachments,
  upsertSyncedAttachment,
}) {
  const attachments = listSyncedAttachments();

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

  console.log("[sync-watch] stopped");
}

function getWatchedPaths() {
  if (!watcher) return [];

  const watched = watcher.getWatched();
  const paths = [];

  Object.entries(watched).forEach(([dir, files]) => {
    files.forEach((file) => {
      paths.push(`${dir}/${file}`);
    });
  });

  return paths;
}

module.exports = {
  startAttachmentWatcher,
  refreshAttachmentWatcher,
  stopAttachmentWatcher,
  getWatchedPaths,
};
