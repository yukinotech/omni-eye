# Omni Eye Monorepo

This repository hosts the full bridge between Model Context Protocol (MCP) servers, a Native Messaging adapter, and the Chrome extension that executes browser capabilities on behalf of an agent. Everything is written in TypeScript and managed with pnpm workspaces.

## Workspace Layout

- `packages/mcp-bundle` – Publishable npm package bundling the native host adapter, shared protocol/core helpers, the MCP server SDK, a small CLI, and install/uninstall scripts that manage the Chrome Native Messaging manifest.
- `packages/extension` – Manifest V3 Chrome extension that talks to the native adapter, relays requests to content scripts, and exposes a minimal popup UI for diagnostics.

## Getting Started

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Build everything:
   ```bash
   pnpm build
   ```
3. Build the extension bundle and load it in Chrome (Developer Mode → Load unpacked → point to `packages/extension/dist`).
4. (Optional) Install the adapter globally during development:
   ```bash
   pnpm --filter mcp-bundle build
   pnpm --filter mcp-bundle link --global
   MCP_EXTENSION_ID=<your_extension_id> pnpm --filter mcp-bundle exec mcp-adapter --help
   ```
   The `postinstall` script will try to register the native host manifest if `MCP_EXTENSION_ID` is provided. Without the ID the script skips registration.

## Development Scripts

Use pnpm filters to run package-level scripts:

```bash
pnpm --filter mcp-bundle build        # Compile adapter + SDK to dist/
pnpm --filter mcp-bundle run dev      # Rebuild on change
pnpm --filter omni-eye-extension build
pnpm --filter omni-eye-extension dev  # Watch background/content scripts
```

## Communication Flow

1. The Chrome extension (background service worker) connects to the native host `mcp_adapter` via Chrome Native Messaging.
2. The native host (adapter) maintains a Unix domain socket / Windows named pipe (`/tmp/mcp-adapter.sock` or `\\.\pipe\mcp-adapter`).
3. One or more MCP servers connect to that socket using the `McpClient` from the SDK, register their capabilities, and exchange requests/responses with the browser.
4. Messages across all boundaries use the same JSON envelope shape which carries `id`, `type`, `cap`, and optional metadata.

## Native Host Manifest

When the `mcp-bundle` package is installed globally, its `postinstall` script calls `scripts/register-native-host.js`. The script:

- Locates the platform-specific `mcp-adapter` executable stub.
- Writes the manifest file to the correct directory for macOS, Linux, or Windows.
- Optionally registers the manifest in the Windows registry.

If the manifest cannot be written (e.g., missing extension ID or adapter binary), the script prints a warning but does not abort installation.

## Extension Overview

- Service worker (`background.ts`) keeps the Native Messaging connection alive, routes adapter requests to the active tab, and tracks outstanding runtime requests.
- Content script (`content.ts`) exposes simple capabilities (`dom.query`, `dom.diff`) as examples.
- Popup (`ui/popup.ts`) provides a lightweight status check and demonstrates messaging into the adapter.

The extension build uses tsup to bundle TypeScript into `dist/`, and a small Node script copies static assets from `public/`.

## Publishing Checklist

- Ensure `packages/mcp-bundle/package.json` has the correct `config.extensionId` before publishing.
- Run `pnpm --filter mcp-bundle build` so `dist/` contains the compiled adapter and scripts.
- Publish `packages/extension/dist` via the Chrome Web Store separately.

## License

MIT (replace or update as needed).
