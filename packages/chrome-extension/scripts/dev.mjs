import { spawn } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { copyFile, mkdir, rm } from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");
const distDir = resolve(projectRoot, "dist");
const manifestSource = resolve(projectRoot, "public/manifest.json");
const manifestTarget = resolve(distDir, "manifest.json");

async function prepareDist() {
  console.log("清理 dist 目录...");
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await copyFile(manifestSource, manifestTarget);
  console.log("manifest.json 已复制到 dist");
}

function startTscWatch() {
  const tsc = spawn("tsc", ["--watch"], {
    cwd: projectRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  tsc.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });

  tsc.on("error", (error) => {
    console.error("启动 tsc 失败:", error);
    process.exit(1);
  });

  const stop = (signal) => {
    if (!tsc.killed) {
      tsc.kill(signal);
    }
  };

  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}

try {
  await prepareDist();
} catch (error) {
  console.error("准备 dist 目录失败:", error);
  process.exit(1);
}

startTscWatch();
