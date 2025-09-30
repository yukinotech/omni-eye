# mcp-bundle

`mcp-bundle` packages everything required to bridge Model Context Protocol (MCP) servers with the Omni Eye Chrome extension through Chrome Native Messaging. It includes:

- The native messaging adapter executable (`bin/mcp-adapter.js`).
- A standalone MCP server entry (`bin/mcp-server.js`) that bridges stdin/stdout clients to the adapter over IPC.
- Shared protocol types/constants (`src/mcp-core`).
- An MCP server SDK (`src/server-sdk`) with a reconnecting `McpClient` and framing helpers.
- Installation scripts that register/unregister the native messaging manifest across macOS, Linux, and Windows.
- A light CLI (`pnpm mcp-bundle run cli status`) for checking adapter socket availability.

## Installation

```bash
pnpm --filter mcp-bundle build
pnpm --filter mcp-bundle link --global
```

Set your published Chrome extension ID before running the postinstall script:

```bash
export MCP_EXTENSION_ID=<32-char-extension-id>
```

Alternatively, update `package.json` → `config.extensionId`. The postinstall script falls back to that value when the environment variable is absent.

## Files Written During Installation

| Platform | Manifest Path | Notes |
| -------- | ------------- | ----- |
| macOS | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/mcp_adapter.json` | File permissions set to 0600. |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/google-chrome/NativeMessagingHosts/mcp_adapter.json` | Honors `$XDG_CONFIG_HOME` when present. |
| Windows | `%LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts\mcp_adapter.json` | Registry key `HKCU\Software\Google\Chrome\NativeMessagingHosts\mcp_adapter` is also created. |

If the adapter binary cannot be located or the extension ID is missing, the script prints a warning and skips registration rather than aborting.

## Programmatic Use

```ts
import { McpClient, adapterSocketPath } from "mcp-bundle";

const client = new McpClient({
  serverId: "dom-diff",
  caps: ["dom.diff", "dom.query"],
  version: "1.0.0"
});

await client.start();
client.sendRequest("request-1", "dom.query", { selector: "h1" });
```

The adapter listens on the path returned by `adapterSocketPath()`: `/tmp/mcp-adapter.sock` on POSIX systems or `\\.\pipe\mcp-adapter` on Windows.

### Bundled MCP server

The package also ships a ready-to-run MCP server that talks to Codex-style tools over STDIN/STDOUT while relaying capability requests through the IPC adapter. After building, it can be executed directly:

```bash
pnpm --filter mcp-bundle exec node dist/mcp-server/index.js
```

Or, once the package is linked globally:

```bash
mcp-server
```

The server currently exposes the DOM capabilities (`dom.diff`, `dom.query`) and forwards each request to the Chrome extension via the adapter socket.


## CLI

```bash
pnpm --filter mcp-bundle exec node dist/cli/index.js status
```

Outputs whether the adapter socket is currently listening.

## Development

- `pnpm --filter mcp-bundle dev` – Watch and rebuild TypeScript sources with tsup.
- `pnpm --filter mcp-bundle build` – Produce publishable artifacts under `dist/`.

Remember to run the build before packing or publishing so `bin/mcp-adapter.js` and the install scripts can locate compiled outputs.
