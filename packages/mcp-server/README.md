# Omni Eye MCP Server

This package hosts the coordination layer between the Chrome extension and AI agents that speak the Model Context Protocol.

## Features

- Spins up a WebSocket bridge on `ws://localhost:7337` that the browser extension connects to automatically.
- Wraps the extension protocol behind high-level methods for navigation, action execution, DOM extraction, snapshot capture, and diffing.
- Registers MCP tools (when `@modelcontextprotocol/sdk` is present) for:
  - `open_page`
  - `capture_snapshot`
  - `perform_actions`
  - `extract_dom`
  - `compare_snapshots`
  - `verify_ui_consistency`
- Provides a workflow helper that opens baseline/candidate URLs, executes optional prompts, captures state, and returns HTML + screenshot diff summaries.

## Scripts

- `pnpm dev` – Run the server in watch mode (requires `tsx`).
- `pnpm build` – Compile TypeScript sources into `dist/`.
- `pnpm start` – Execute the compiled JavaScript.

## Extending the Server

1. Optional – install the SDK dependency to expose the built-in tools:
   ```bash
   pnpm add --filter @omni-eye/mcp-server @modelcontextprotocol/sdk
   ```
2. Adjust `src/index.ts` or `src/workflows.ts` to encode custom scenarios (e.g. multi-step validation, persistence, alternative diffing strategies).
3. Extend `src/bridge.ts` if you need richer streaming updates (telemetry, incremental diffs, etc.).

The MCP tools return JSON responses, making them straightforward to consume from coordinating agents or test harnesses.
