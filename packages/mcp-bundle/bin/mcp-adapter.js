#!/usr/bin/env node
const path = require("path");
const fs = require("fs");

function load() {
  const distPath = path.join(__dirname, "..", "dist", "adapter", "main.js");
  if (fs.existsSync(distPath)) {
    return require(distPath);
  }
  console.error("[mcp-bundle] Adapter build output missing. Run 'pnpm --filter mcp-bundle build'.");
  process.exit(1);
}

const mod = load();
if (mod && typeof mod.start === "function") {
  mod.start();
} else if (mod && mod.startAdapter) {
  mod.startAdapter();
} else {
  console.error("[mcp-bundle] Failed to locate adapter start function.");
  process.exit(1);
}
