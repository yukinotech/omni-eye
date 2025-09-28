import { spawn } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { copyFile, mkdir, rm } from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");
const tsconfigBuildInfo = resolve(projectRoot, "tsconfig.tsbuildinfo");
const distDir = resolve(projectRoot, "dist");
const manifestSource = resolve(projectRoot, "public/manifest.json");
const manifestTarget = resolve(distDir, "manifest.json");
const iconSource = resolve(projectRoot, "public/icon.png");
const iconTarget = resolve(distDir, "icon.png");

async function prepareDist() {
  console.log("清理 dist 目录...");
  await rm(distDir, { recursive: true, force: true });
  await rm(tsconfigBuildInfo, { force: true });
  await mkdir(distDir, { recursive: true });
  await copyFile(manifestSource, manifestTarget);
  await copyFile(iconSource, iconTarget);
  console.log("manifest.json , icon.png 已复制到 dist");
}

try {
  await prepareDist();
} catch (error) {
  console.error("准备 dist 目录失败:", error);
  process.exit(1);
}
