#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function isWorkspaceInstall() {
  const pkgRoot = path.join(__dirname, "..");
  const workspaceMarker = path.join(pkgRoot, "tsconfig.json");

  if (fs.existsSync(workspaceMarker)) {
    console.log("[mcp-bundle] Skipping native host cleanup during workspace uninstall.");
    return true;
  }

  return false;
}

if (isWorkspaceInstall()) {
  process.exit(0);
}

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
