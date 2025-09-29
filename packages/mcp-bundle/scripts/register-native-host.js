#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function load() {
  const distPath = path.join(__dirname, "..", "dist", "scripts", "registerNativeHost.js");
  if (fs.existsSync(distPath)) {
    return require(distPath);
  }
  console.warn("[mcp-bundle] Build output missing. Skipping native host registration.");
  console.warn("[mcp-bundle] Run 'pnpm --filter mcp-bundle build' before installing globally.");
  return null;
}

const mod = load();
if (mod && typeof mod.registerNativeHost === "function") {
  mod.registerNativeHost();
}
