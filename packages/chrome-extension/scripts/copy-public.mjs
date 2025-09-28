import { cp, stat } from 'fs/promises';
import { watch } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const projectRoot = resolve(__dirname, '..');
const publicDir = resolve(projectRoot, 'public');
const distDir = resolve(projectRoot, 'dist');

async function verifyPublicDir() {
  try {
    await stat(publicDir);
  } catch (error) {
    throw new Error(`Public assets directory not found: ${publicDir}`);
  }
}

async function copyAssets() {
  await cp(publicDir, distDir, { recursive: true });
}

async function main() {
  await verifyPublicDir();
  await copyAssets();

  if (!process.argv.includes('--watch')) {
    return;
  }

  let copying = false;
  let pending = false;
  let pollInterval;

  const triggerCopy = () => {
    if (copying) {
      pending = true;
      return;
    }

    copying = true;
    copyAssets()
      .catch((error) => {
        console.error(error);
        process.exitCode = 1;
      })
      .finally(() => {
        copying = false;
        if (pending) {
          pending = false;
          triggerCopy();
        }
      });
  };

  const cleanupHandlers = [];

  const addCleanup = (handler) => {
    cleanupHandlers.push(handler);
  };

  const cleanup = () => {
    for (const handler of cleanupHandlers) {
      handler();
    }
  };

  const startPolling = () => {
    if (pollInterval) {
      return;
    }

    pollInterval = setInterval(triggerCopy, 1000);
    addCleanup(() => {
      clearInterval(pollInterval);
    });
  };

  try {
    const watcher = watch(publicDir, { recursive: false }, (eventType, filename) => {
      if (!filename) {
        return;
      }
      triggerCopy();
    });

    watcher.on('error', (error) => {
      console.warn('File watching failed, falling back to polling copy:', error);
      watcher.close();
      startPolling();
    });

    addCleanup(() => {
      watcher.close();
    });
  } catch (error) {
    console.warn('File watching unavailable, falling back to polling copy:', error);
    startPolling();
  }

  process.on('SIGINT', () => {
    cleanup();
    process.exit();
  });

  process.on('SIGTERM', () => {
    cleanup();
    process.exit();
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
