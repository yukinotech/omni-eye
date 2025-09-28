# Omni Eye Monorepo

Monorepo scaffolding for the Omni Eye project. It contains a Chrome extension that can navigate, execute DOM interactions, capture DOM/screenshot snapshots, and stream data to a coordinating MCP-compatible server built with Node.js and TypeScript.

## Packages

- `packages/chrome-extension` – Manifest V3 extension; exposes navigation, action, capture, extraction, and diff commands over a WebSocket bridge.
- `packages/mcp-server` – Node.js service that orchestrates the extension, surfaces MCP tools (open page, perform actions, capture/extract, compare, verify), and provides higher-level workflows.

## Getting Started

```bash
pnpm install
pnpm build
```

Each package keeps its own scripts; run them with pnpm filters, for example:

```bash
pnpm --filter @omni-eye/chrome-extension dev
pnpm --filter @omni-eye/mcp-server dev
```

### Developing the Extension

1. Build the extension (`pnpm --filter @omni-eye/chrome-extension build`).
2. Copy `packages/chrome-extension/public/manifest.json` plus the generated `dist` assets into a fresh folder (or create a small build script to do so).
3. Load the folder as an unpacked extension in Chrome.

### Running the MCP Bridge

```bash
pnpm --filter @omni-eye/mcp-server dev
```

The server listens for a WebSocket connection from the browser extension on `ws://localhost:7337`. Install `@modelcontextprotocol/sdk` to expose the built-in tools (navigation, action execution, capture, DOM extraction, snapshot comparison, UI verification). Without the SDK, the bridge still runs and logs snapshots, which is helpful during development.

## Next Steps

- Add an automated build step that bundles manifest + TypeScript output for the extension.
- Integrate the official MCP SDK to declare resources and tools tailored to your AI agent workflow.
- Wire agent-side automation logic (e.g., Playwright) to call the MCP tools and reconcile detected diffs.
