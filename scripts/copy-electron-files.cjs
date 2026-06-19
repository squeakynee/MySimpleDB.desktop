const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function copyFile(from, to) {
  const source = path.join(root, from);
  const dest = path.join(root, to);

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);

  console.log(`[copy-electron-files] copied ${from} -> ${to}`);
}

function copyDir(from, to) {
  const source = path.join(root, from);
  const dest = path.join(root, to);

  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(source, dest, { recursive: true });

  console.log(`[copy-electron-files] copied ${from} -> ${to}`);
}

copyFile("electron/preload.cjs", "dist-electron/preload.cjs");
copyDir("electron/sync", "dist-electron/sync");
