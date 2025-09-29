import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "adapter/main": "src/adapter/main.ts",
    "adapter/native-io": "src/adapter/nativeIo.ts",
    "adapter/logger": "src/adapter/logger.ts",
    "server-sdk/index": "src/server-sdk/index.ts",
    "scripts/registerNativeHost": "src/scripts/registerNativeHost.ts",
    "scripts/unregisterNativeHost": "src/scripts/unregisterNativeHost.ts",
    "cli/index": "src/cli/index.ts"
  },
  format: ["cjs"],
  target: "node18",
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: true,
  skipNodeModulesBundle: true,
  minify: false
});
