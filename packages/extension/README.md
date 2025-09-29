# Omni Eye Chrome Extension

Manifest V3 extension that bridges browser automation requests between the Omni Eye native adapter (`mcp-bundle`) and web pages.

## Scripts

```bash
pnpm --filter omni-eye-extension build   # Bundle background/content/popup scripts into dist/
pnpm --filter omni-eye-extension dev     # Watch TypeScript sources and rebuild on change
```

`tsup` compiles `src/background.ts`, `src/content.ts`, and `src/ui/popup.ts` into ESM modules. After every build, `scripts/copy-assets.js` copies the static assets from `public/` (manifest, popup HTML, icons) into `dist/`.

## Loading the Extension Locally

1. Build the project: `pnpm --filter omni-eye-extension build`.
2. Open Chrome → `chrome://extensions` → enable Developer Mode.
3. Click **Load unpacked** and choose `packages/extension/dist`.
4. Update `MCP_EXTENSION_ID` (or `packages/mcp-bundle/package.json` → `config.extensionId`) with the ID Chrome assigns so the native host manifest can be written correctly.

## Runtime Flow

- The background service worker connects to the native messaging host `mcp_adapter` and relays JSON envelopes.
- Incoming `REQUEST` envelopes are routed to the active tab's content script.
- The content script demonstrates two capabilities:
  - `dom.query` – Returns metadata about nodes matching a CSS selector.
  - `dom.diff` – Returns the full document HTML snapshot as a baseline for diffing.
- `ui/popup.ts` provides a small diagnostic UI that pings the adapter via the background script.

The background script also accepts envelopes sent from other extension contexts via `chrome.runtime.sendMessage`, making it easy to extend capabilities or build richer dev tools.
