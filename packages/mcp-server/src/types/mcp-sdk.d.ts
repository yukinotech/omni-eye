declare module "@modelcontextprotocol/sdk" {
  export * from "@modelcontextprotocol/sdk/dist/esm/index.js";
}

declare module "@modelcontextprotocol/sdk/server" {
  export * from "@modelcontextprotocol/sdk/dist/esm/server/index.js";
}

declare module "@modelcontextprotocol/sdk/server/mcp.js" {
  export { McpServer } from "@modelcontextprotocol/sdk/dist/esm/server/mcp.js";
}

declare module "@modelcontextprotocol/sdk/server/stdio.js" {
  export { StdioServerTransport } from "@modelcontextprotocol/sdk/dist/esm/server/stdio.js";
}

declare module "@modelcontextprotocol/sdk/dist/esm/server/mcp.js" {
  export { McpServer } from "@modelcontextprotocol/sdk/dist/esm/server/mcp";
}

declare module "@modelcontextprotocol/sdk/dist/esm/server/stdio.js" {
  export { StdioServerTransport } from "@modelcontextprotocol/sdk/dist/esm/server/stdio";
}
