import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const expectedTools = new Set([
  "open_page",
  "capture_snapshot",
  "perform_actions",
  "extract_dom",
  "compare_snapshots",
  "verify_ui_consistency",
]);

type ToolCallResult = {
  content?: Array<{ type: string; json?: unknown; value?: unknown }>;
  structuredContent?: unknown;
  json?: unknown;
  value?: unknown;
};

function extractJsonPayload(result: ToolCallResult): any {
  if (Array.isArray(result.content) && result.content.length > 0) {
    const block = result.content[0];
    if (block.type === "json") {
      if ("json" in block && block.json !== undefined) {
        return block.json;
      }
      if ("value" in block && block.value !== undefined) {
        return block.value;
      }
    }
  }

  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }

  if (result.json !== undefined) {
    return result.json;
  }

  if (result.value !== undefined) {
    return result.value;
  }

  return result;
}

async function safeClose(action: () => Promise<void> | void): Promise<void> {
  try {
    await action();
  } catch {
    // ignore cleanup errors in tests
  }
}

async function main(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const tsxBin = path.resolve(__dirname, "../node_modules/.bin/tsx");
  const serverEntry = path.resolve(__dirname, "../src/index.ts");

  const client = new Client(
    { name: "omni-eye-cli-test", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  const transport = new StdioClientTransport({
    command: tsxBin,
    args: [serverEntry],
  });

  try {
    await client.connect(transport);

    const toolList = await client.listTools({});
    console.log("toolList", toolList);
    const openPageResult = await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/open", newTab: true },
    });
    console.log("openPageResult", openPageResult);
    const openPayload = extractJsonPayload(openPageResult as ToolCallResult);
    console.log("openPayload", openPayload);
    //   assert.equal(openPayload.url, "https://example.com/open");
    //   assert.equal(openPayload.title, "Mock page for https://example.com/open");
  } catch (error) {
    console.error("Open page test failed", error);
    process.exit(1);
  } finally {
    await safeClose(() => client.close());
  }
}

main().catch((error) => {
  console.error("Integration test failed", error);
  process.exit(1);
});
