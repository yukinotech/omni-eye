import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import WebSocket, { type RawData } from "ws";

import type {
  AgentCommand,
  AgentResponse,
  DomExtractionResult,
  PageAction,
  Screenshot,
  Snapshot,
} from "../src/messages.js";

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

// class MockExtension {
//   private readonly url: string;
//   private socket: WebSocket | null = null;
//   private tabCounter = 1;
//   private readonly captureCounts = new Map<number, number>();

//   constructor(url = "ws://127.0.0.1:7337") {
//     this.url = url;
//   }

//   async connect(retries = 50, delayMs = 100): Promise<void> {
//     for (let attempt = 1; attempt <= retries; attempt++) {
//       try {
//         await this.connectOnce();
//         return;
//       } catch (error) {
//         if (attempt === retries) {
//           throw error;
//         }
//         await wait(delayMs);
//       }
//     }
//   }

//   async close(): Promise<void> {
//     if (!this.socket) {
//       return;
//     }

//     await new Promise<void>((resolve) => {
//       const socket = this.socket!;
//       const cleanup = () => {
//         socket.off("close", cleanup);
//         socket.off("error", cleanup);
//         resolve();
//       };

//       socket.once("close", cleanup);
//       socket.once("error", cleanup);
//       socket.close();
//     });

//     this.socket = null;
//   }

//   private connectOnce(): Promise<void> {
//     return new Promise<void>((resolve, reject) => {
//       const socket = new WebSocket(this.url);

//       const handleError = (error: unknown) => {
//         socket.off("open", handleOpen);
//         socket.off("close", handleClose);
//         reject(error);
//       };

//       const handleOpen = () => {
//         socket.off("error", handleError);

//         this.socket = socket;
//         socket.on("message", (data: RawData) => this.handleMessage(data));
//         socket.on("error", (error: unknown) => {
//           console.error("Mock extension socket error", error);
//         });
//         socket.on("close", () => {
//           this.socket = null;
//         });

//         resolve();
//       };

//       const handleClose = () => {
//         this.socket = null;
//       };

//       socket.once("open", handleOpen);
//       socket.once("error", handleError);
//       socket.once("close", handleClose);
//     });
//   }

//   private handleMessage(data: RawData): void {
//     if (!this.socket) {
//       return;
//     }

//     try {
//       const message = JSON.parse(data.toString()) as AgentCommand;
//       if (!message || typeof message !== "object" || !("kind" in message)) {
//         return;
//       }

//       switch (message.kind) {
//         case "agent:navigate":
//           this.respond({
//             kind: "agent:navigate:result",
//             requestId: message.requestId,
//             tabId: this.allocateTabId(message.tabId),
//             url: message.url,
//             title: `Mock page for ${message.url}`,
//           });
//           break;
//         case "agent:capture":
//           this.respond({
//             kind: "agent:capture:result",
//             requestId: message.requestId,
//             snapshot: this.createSnapshot(this.captureLabelForTab(message.tabId)),
//           });
//           break;
//         case "agent:actions":
//           this.respond({
//             kind: "agent:actions:result",
//             requestId: message.requestId,
//             results: message.actions.map((action: PageAction, index: number) => ({
//               index,
//               action,
//               status: "success" as const,
//               message: `Executed ${action.type}`,
//             })),
//             snapshot: this.createSnapshot(`actions-${message.requestId}`),
//             screenshot: this.createScreenshot(`actions-${message.requestId}`),
//           });
//           break;
//         case "agent:dom":
//           this.respond({
//             kind: "agent:dom:result",
//             requestId: message.requestId,
//             extraction: this.createDomExtraction(message.extraction?.selector ?? { css: "body" }),
//           });
//           break;
//         case "agent:screenshot":
//           this.respond({
//             kind: "agent:screenshot:result",
//             requestId: message.requestId,
//             screenshot: this.createScreenshot(`screenshot-${message.tabId ?? 0}`),
//           });
//           break;
//         case "agent:diff":
//           this.respond({
//             kind: "agent:diff:result",
//             requestId: message.requestId,
//             baselineId: message.baselineId,
//             htmlDiff: [
//               { type: "unchanged", value: "<body>...</body>" },
//               { type: "added", value: "<div>mock</div>" },
//             ],
//             screenshotDiff: {
//               totalPixels: 100,
//               differingPixels: 5,
//               mismatchRatio: 0.05,
//               diffImage: this.createScreenshot("diff"),
//             },
//           });
//           break;
//         default:
//           this.respond({
//             kind: "agent:error",
//             requestId: (message as AgentCommand).requestId,
//             message: `Unsupported command ${(message as AgentCommand).kind}`,
//             recoverable: false,
//           });
//       }
//     } catch (error) {
//       console.error("Mock extension failed to handle message", error);
//     }
//   }

//   private respond(response: AgentResponse): void {
//     this.socket?.send(JSON.stringify(response));
//   }

//   private allocateTabId(requested?: number): number {
//     if (typeof requested === "number") {
//       return requested;
//     }

//     return this.tabCounter++;
//   }

//   private captureLabelForTab(tabId?: number): string {
//     const key = typeof tabId === "number" ? tabId : 0;
//     const count = this.captureCounts.get(key) ?? 0;
//     const label = count === 0 ? `capture-${key}` : `capture-${count + 1}`;
//     this.captureCounts.set(key, count + 1);
//     return label;
//   }

//   private createDomExtraction(selector: { css?: string }): DomExtractionResult {
//     return {
//       elements: [
//         {
//           selector,
//           html: "<div id=\"mock\">Content</div>",
//           text: "Content",
//           attributes: { id: "mock" },
//           computedStyles: { display: "block" },
//           bounds: this.createBounds(),
//         },
//       ],
//     };
//   }

//   private createSnapshot(label: string): Snapshot {
//     return {
//       id: `snapshot-${label}`,
//       url: `https://example.com/${label}`,
//       title: `Snapshot ${label}`,
//       capturedAt: new Date().toISOString(),
//       html: `<html data-label=\"${label}\"></html>`,
//       viewport: this.createViewport(),
//       screenshot: this.createScreenshot(label),
//       metadata: { label },
//     };
//   }

//   private createScreenshot(label: string): Screenshot {
//     const data = Buffer.from(label).toString("base64");
//     return {
//       format: "png",
//       dataUrl: `data:image/png;base64,${data}`,
//       width: 1280,
//       height: 720,
//     };
//   }

//   private createViewport() {
//     return {
//       width: 1280,
//       height: 720,
//       scrollX: 0,
//       scrollY: 0,
//       devicePixelRatio: 1,
//     };
//   }

//   private createBounds() {
//     return {
//       x: 0,
//       y: 0,
//       width: 640,
//       height: 480,
//       top: 0,
//       right: 640,
//       bottom: 480,
//       left: 0,
//     };
//   }
// }

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const tsxBin = path.resolve(__dirname, "../node_modules/.bin/tsx");
  const serverEntry = path.resolve(__dirname, "../src/index.ts");

  // const mockExtension = new MockExtension();

  const client = new Client(
    { name: "omni-eye-cli-test", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  const transport = new StdioClientTransport({
    command: tsxBin,
    args: [serverEntry],
  });

  await client.connect(transport);
  // await mockExtension.connect();

  const toolList = await client.listTools({});
  console.log(toolList);
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
    "HTML diff blocks: 1. Screenshot mismatch 5.00% across 100 pixels.",
  );
  assert.equal(verifyPayload.baselineSnapshot.id, "snapshot-capture-1");
  assert.equal(verifyPayload.candidateSnapshot.id, "snapshot-capture-2");

  await client.close();
  await mockExtension.close();
}

main().catch((error) => {
  console.error("Integration test failed", error);
  process.exit(1);
});
