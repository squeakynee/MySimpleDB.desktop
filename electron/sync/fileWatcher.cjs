const path = require("node:path");
const fs = require("node:fs");
const chokidar = require("chokidar");

let watcher = null;
let debounceTimers = new Map();
let watchedPathSet = new Set();

let activeUserId = null;

function getWatchableAttachments(listSyncedAttachments, userId) {
  return listSyncedAttachments(userId)
    .filter((item) => item.syncEnabled !== false)
    .filter((item) => item.localPath)
    .filter((item) => !String(item.localPath).startsWith("./"));
}

function hasLocalFileChanged(attachment, stat) {
  const currentMtime = Number(stat.mtimeMs || 0);
  const currentSize = Number(stat.size || 0);

  const previousMtime = Number(attachment.lastSeenMtime || 0);
  const previousSize = Number(attachment.lastSeenSize || 0);

  // mtime can have tiny floating point differences, so use a 1 ms tolerance.
  const mtimeChanged = Math.abs(currentMtime - previousMtime) > 1;
  const sizeChanged = currentSize !== previousSize;

  return {
    changed: mtimeChanged || sizeChanged,
    currentMtime,
    currentSize,
    previousMtime,
    previousSize,
  };
}

function markAttachmentModifiedLocal({
  attachment,
  upsertSyncedAttachment,
  reason,
}) {
  const updated = upsertSyncedAttachment({
    ...attachment,
    syncStatus: "modified-local",
    pendingUpload: true,
  });

  console.log("[sync-watch] marked pending upload:", {
    reason,
    attachmentId: attachment.attachmentId,
    localPath: attachment.localPath,
  });

  return updated;
}

function markAttachmentUnavailable({
  attachment,
  upsertSyncedAttachment,
  reason,
}) {
  const updated = upsertSyncedAttachment({
    ...attachment,
    syncStatus: "unavailable",
    pendingUpload: false,
    lastSeenMtime: null,
    lastSeenSize: null,
  });

  console.warn("[sync-watch] marked unavailable:", {
    reason,
    attachmentId: attachment.attachmentId,
    localPath: attachment.localPath,
    updatedSyncStatus: updated?.syncStatus,
  });

  return updated;
}

function normalizePathForCompare(value) {
  if (!value) return "";
  return path.resolve(String(value));
}

function findAttachmentByPath(attachments, filePath) {
  const target = normalizePathForCompare(filePath);

  return attachments.find(
    (item) => normalizePathForCompare(item.localPath) === target
  );
}

/**
 * Startup/resume recovery scan.
 *
 * This catches local file edits that happened while Desktop was closed,
 * asleep, disconnected, or before chokidar was active.
 */
function scanLocalFilesForChanges({
  userId,
  listSyncedAttachments,
  upsertSyncedAttachment,
}) {
  const attachments = getWatchableAttachments(listSyncedAttachments, userId);

  const result = {
    ok: true,
    scanned: 0,
    changed: 0,
    missing: 0,
    unchanged: 0,
    markedPending: [],
    missingFiles: [],
  };

  for (const attachment of attachments) {
    result.scanned += 1;

    let stat;

    try {
      stat = fs.statSync(attachment.localPath);
    } catch (err) {
      result.missing += 1;

      markAttachmentUnavailable({
        attachment,
        upsertSyncedAttachment,
        reason: "startup-scan-missing",
      });

      result.missingFiles.push({
        attachmentId: attachment.attachmentId,
        localPath: attachment.localPath,
      });

      console.warn("[sync-watch] startup scan local file missing:", {
        attachmentId: attachment.attachmentId,
        localPath: attachment.localPath,
      });

      continue;
    }

    const change = hasLocalFileChanged(attachment, stat);

    if (!change.changed) {
      result.unchanged += 1;
      continue;
    }

    result.changed += 1;

    console.log("[sync-watch] startup scan found local change:", {
      attachmentId: attachment.attachmentId,
      localPath: attachment.localPath,
      previousMtime: change.previousMtime,
      currentMtime: change.currentMtime,
      previousSize: change.previousSize,
      currentSize: change.currentSize,
    });

    markAttachmentModifiedLocal({
      attachment,
      upsertSyncedAttachment,
      reason: "startup-scan",
    });

    result.markedPending.push({
      attachmentId: attachment.attachmentId,
      localPath: attachment.localPath,
      previousMtime: change.previousMtime,
      currentMtime: change.currentMtime,
      previousSize: change.previousSize,
      currentSize: change.currentSize,
    });
  }

  console.log("[sync-watch] startup scan complete:", result);

  return result;
}

function startAttachmentWatcher({
  userId,
  listSyncedAttachments,
  upsertSyncedAttachment,
}) {
  activeUserId = userId;

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
          userId: activeUserId,
          filePath,
          listSyncedAttachments,
          upsertSyncedAttachment,
        });
      }, 500)
    );
  });

  watcher.on("add", (filePath) => {
    clearTimeout(debounceTimers.get(filePath));

    debounceTimers.set(
      filePath,
      setTimeout(() => {
        console.log("[sync-watch] watched file restored:", filePath);

        handleLocalFileChange({
          userId: activeUserId,
          filePath,
          listSyncedAttachments,
          upsertSyncedAttachment,
        });
      }, 500)
    );
  });

  watcher.on("unlink", (filePath) => {
    setTimeout(() => {
      if (fs.existsSync(filePath)) {
        console.log(
          "[sync-watch] unlink was temporary, file exists:",
          filePath
        );

        handleLocalFileChange({
          userId: activeUserId,
          filePath,
          listSyncedAttachments,
          upsertSyncedAttachment,
        });

        return;
      }

      const attachments = listSyncedAttachments(activeUserId);
      const attachment = findAttachmentByPath(attachments, filePath);

      if (!attachment) {
        console.warn("[sync-watch] missing file not tracked:", filePath);
        return;
      }

      markAttachmentUnavailable({
        attachment,
        upsertSyncedAttachment,
        reason: "watcher-unlink",
      });
    }, 1500);
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
  activeUserId = userId;

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

function getDbWatchedPaths(listSyncedAttachments, userId) {
  return getWatchableAttachments(listSyncedAttachments, userId).map(
    (item) => item.localPath
  );
}

function handleLocalFileChange({
  userId,
  filePath,
  listSyncedAttachments,
  upsertSyncedAttachment,
}) {
  const attachments = listSyncedAttachments(userId);
  const attachment = findAttachmentByPath(attachments, filePath);

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

  const change = hasLocalFileChanged(attachment, stat);

  if (!change.changed && attachment.syncStatus !== "unavailable") {
    return;
  }

  console.log("[sync-watch] local file modified:", {
    attachmentId: attachment.attachmentId,
    filePath,
    previousMtime: change.previousMtime,
    currentMtime: change.currentMtime,
    previousSize: change.previousSize,
    currentSize: change.currentSize,
  });

  markAttachmentModifiedLocal({
    attachment,
    upsertSyncedAttachment,
    reason: "watcher-change",
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
  getDbWatchedPaths,
  scanLocalFilesForChanges,
};
