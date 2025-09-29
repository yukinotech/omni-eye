#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function load() {
  const distPath = path.join(__dirname, "..", "dist", "scripts", "unregisterNativeHost.js");
  if (fs.existsSync(distPath)) {
    return require(distPath);
  }
  console.warn("[mcp-bundle] Build output missing. Skipping native host cleanup.");
  return null;
}

const mod = load();
if (mod && typeof mod.unregisterNativeHost === "function") {
  mod.unregisterNativeHost();
}
