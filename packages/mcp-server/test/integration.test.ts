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

async function main(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const tsxBin = path.resolve(__dirname, "../node_modules/.bin/tsx");
  const serverEntry = path.resolve(__dirname, "mock-server.ts");

  const client = new Client(
    { name: "omni-eye-cli-test", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  const transport = new StdioClientTransport({
    command: tsxBin,
    args: [serverEntry],
  });

  await client.connect(transport);

  const toolList = await client.listTools({});
  const available = new Set(toolList.tools.map((tool) => tool.name));
  for (const name of expectedTools) {
    assert.ok(available.has(name), `Expected tool ${name} to be registered`);
  }

  const openPageResult = await client.callTool({
    name: "open_page",
    arguments: { url: "https://example.com/open", newTab: true },
  });
  const openPayload = extractJsonPayload(openPageResult as ToolCallResult);
  assert.equal(openPayload.url, "https://example.com/open");
  assert.equal(openPayload.title, "Mock page for https://example.com/open");

  const captureResult = await client.callTool({
    name: "capture_snapshot",
    arguments: { tabId: 7, includeScreenshot: true },
  });
  const capturePayload = extractJsonPayload(captureResult as ToolCallResult);
  assert.equal(capturePayload.id, "snapshot-capture-7");
  assert.equal(capturePayload.screenshot.format, "png");

  const performResult = await client.callTool({
    name: "perform_actions",
    arguments: {
      tabId: 5,
      actions: [
        { type: "click", selector: { css: "#login" } },
        { type: "waitFor", condition: { strategy: "exists", selector: { css: "#ready" } } },
      ],
    },
  });
  const actionsPayload = extractJsonPayload(performResult as ToolCallResult);
  assert.equal(actionsPayload.results.length, 2);
  assert.equal(actionsPayload.results[0].status, "success");

  const verifyResult = await client.callTool({
    name: "verify_ui_consistency",
    arguments: {
      reuseTab: true,
      baseline: { url: "https://baseline.example.com" },
      candidate: { url: "https://candidate.example.com" },
    },
  });
  const verifyPayload = extractJsonPayload(verifyResult as ToolCallResult);
  assert.equal(
    verifyPayload.summary,
    "Compared https://baseline.example.com to https://candidate.example.com",
  );
  assert.equal(verifyPayload.baselineSnapshot.id, "snapshot-capture-1");
  assert.equal(verifyPayload.candidateSnapshot.id, "snapshot-capture-2");

  await client.close();
}

main().catch((error) => {
  console.error("Integration test failed", error);
  process.exit(1);
});
