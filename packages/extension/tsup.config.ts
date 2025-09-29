import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    background: "src/background.ts",
    content: "src/content.ts",
    "ui/popup": "src/ui/popup.ts"
  },
  format: "esm",
  target: "chrome110",
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  skipNodeModulesBundle: true
});
