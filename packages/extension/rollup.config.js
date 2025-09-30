import typescript from "@rollup/plugin-typescript";

export default [
  // background + popup 保持 ES module
  {
    input: {
      background: "src/background.ts",
      "ui/popup": "src/ui/popup.ts",
    },
    output: {
      dir: "dist",
      format: "es", // 保持 module
    },
    plugins: [typescript()],
  },
  // content.js 单独打包成 IIFE
  {
    input: "src/content.ts",
    output: {
      file: "dist/content.js",
      format: "iife", // 没有 import
    },
    plugins: [typescript()],
  },
];
