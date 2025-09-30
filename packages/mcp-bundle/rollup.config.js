import typescript from "@rollup/plugin-typescript";

export default [
  {
    input: {
      "adapter/main": "src/adapter/main.ts",
      "scripts/registerNativeHost": "src/scripts/registerNativeHost.ts",
      "scripts/unregisterNativeHost": "src/scripts/unregisterNativeHost.ts",
      "mcp-server/index": "src/mcp-server/index.ts",
    },
    output: {
      dir: "dist",
      format: "cjs",
    },
    plugins: [typescript()],
  },
];
