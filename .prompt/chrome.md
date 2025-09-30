1. 用@modelcontextprotocol/sdk实现packages/mcp-bundle/src/mcp-server/index.ts
2. mcp-server目标是被codex或者cursor的AI工具调用
3. mcp-server被调用后，会通过IPC和adapter通信，这部分的代码在server sdk和mcp-core里有参考