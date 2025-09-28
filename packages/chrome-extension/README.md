# Omni Eye Chrome Extension

A Manifest V3 extension that coordinates with the MCP server to automate browser flows, capture DOM and screenshots, and stream comparison data back to the agent. The background service worker exposes a command channel over `chrome.runtime.sendMessage` and an externally connectable WebSocket bridge (`ws://localhost:7337`).

## Capabilities

- Navigate to URLs (new or existing tabs) and optionally wait for selectors to appear.
- Execute action sequences (click, input, scroll, wait, focus, clear) derived from structured tool inputs or free-form prompts.
- Capture DOM snapshots enriched with viewport metrics and optional screenshots.
- Persist snapshots and request HTML/screenshot diffs against stored baselines.
- Extract DOM fragments (HTML/text/attributes/styles) for downstream analysis.
- Stream snapshot metadata to the MCP server for orchestration and reporting.

## Scripts

- `pnpm build` – compile TypeScript sources into `dist/`
- `pnpm dev` – watch mode for iterative development

After building, copy the generated files together with `public/manifest.json` into a Chrome developer extension directory:

1. Run `pnpm --filter @omni-eye/chrome-extension build` from the workspace root (or `pnpm build` inside this package).
2. Create a `dist/` folder that contains the emitted JavaScript alongside `public/manifest.json`.
3. Load the extension in Chrome via **chrome://extensions** → **Load unpacked**.

## Runtime API

The service worker accepts the following command payloads (via `chrome.runtime.sendMessage`, external connections, or the MCP bridge):

- `agent:navigate` – open/update a tab and wait for optional selectors.
- `agent:actions` – run page actions and optionally capture/snapshot results.
- `agent:capture` / `agent:screenshot` / `agent:dom` – retrieve DOM/screenshot data.
- `agent:diff` – compare stored snapshots and emit HTML + screenshot diffs.

The injected content script also exposes a helper on `window.omniEye`:

```ts
window.omniEye?.captureSnapshot();
window.omniEye?.performActions([{ type: "click", selector: { css: "button.primary" } }]);
window.omniEye?.waitFor({ selector: { text: "Loaded" } });
```

These utilities mirror the command channel and are useful when debugging complex flows directly from the DevTools console.
