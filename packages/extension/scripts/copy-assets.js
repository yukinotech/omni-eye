#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function copyRecursive(src, dest) {
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function main() {
  const publicDir = path.resolve(__dirname, "..", "public");
  const distDir = path.resolve(__dirname, "..", "dist");
  if (!fs.existsSync(publicDir)) {
    return;
  }
  copyRecursive(publicDir, distDir);
}

main();
