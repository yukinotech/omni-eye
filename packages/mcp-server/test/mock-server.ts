import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";

import {
  createOmniEyeMcpServer,
  type OmniEyeClientAdapter,
  type OmniEyeWorkflowsAdapter,
} from "../src/index.js";
import type {
  ActionResult,
  DomExtractionResult,
  ElementSelector,
  Screenshot,
  Snapshot,
  Viewport,
  WaitCondition,
} from "../src/messages.js";
import type {
  ActionParams,
  CaptureParams,
  CompareParams,
  DomExtractionParams,
  NavigateParams,
} from "../src/client.js";
import type { UiConsistencyRequest, UiConsistencyResult } from "../src/workflows.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

class MockOmniEyeClient implements OmniEyeClientAdapter {
  private tabCounter = 1;

  async navigate(params: NavigateParams) {
    const tabId = params.tabId ?? this.tabCounter++;
    return {
      kind: "agent:navigate:result" as const,
      requestId: `navigate:${tabId}`,
      tabId,
      url: params.url,
      title: `Mock page for ${params.url}`,
    };
  }

  async capture(params: CaptureParams = {}): Promise<Snapshot> {
    const tabId = params.tabId ?? 0;
    return this.createSnapshot(`capture-${tabId}`);
  }

  async performActions(params: ActionParams) {
    const requestId = randomUUID();
    const results: ActionResult[] = params.actions.map((action, index) => ({
      index,
      action,
      status: "success",
      message: `Executed ${action.type}`,
    }));

    return {
      kind: "agent:actions:result" as const,
      requestId,
      results,
      snapshot: this.createSnapshot(`actions-${requestId}`),
      screenshot: this.createScreenshot(`actions-${requestId}`),
    };
  }

  async extractDom(params: DomExtractionParams): Promise<DomExtractionResult> {
    return {
      elements: [
        {
          selector: params.extraction.selector ?? { css: "body" },
          html: "<div id=\"mock\">Content</div>",
          text: "Content",
          attributes: { id: "mock" },
          computedStyles: { display: "block" },
          bounds: this.createBounds(),
        },
      ],
    };
  }

  async compareSnapshots(params: CompareParams) {
    return {
      kind: "agent:diff:result" as const,
      requestId: randomUUID(),
      baselineId: params.baselineId,
      htmlDiff: [
        { type: "unchanged", value: "<body>...</body>" },
        { type: "added", value: "<div>mock</div>" },
      ],
      screenshotDiff: {
        totalPixels: 100,
        differingPixels: 5,
        mismatchRatio: 0.05,
        diffImage: this.createScreenshot("diff"),
      },
    };
  }

  private createSnapshot(label: string): Snapshot {
    return {
      id: `snapshot-${label}`,
      url: `https://example.com/${label}`,
      title: `Snapshot ${label}`,
      capturedAt: new Date().toISOString(),
      html: `<html data-label=\"${label}\"></html>`,
      viewport: this.createViewport(),
      screenshot: this.createScreenshot(label),
      metadata: { label },
    };
  }

  private createViewport(): Viewport {
    return {
      width: 1280,
      height: 720,
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 1,
    };
  }

  private createScreenshot(label: string): Screenshot {
    const data = Buffer.from(label).toString("base64");
    return {
      format: "png",
      dataUrl: `data:image/png;base64,${data}`,
      width: 1280,
      height: 720,
    };
  }

  private createBounds() {
    return {
      x: 0,
      y: 0,
      width: 640,
      height: 480,
      top: 0,
      right: 640,
      bottom: 480,
      left: 0,
    };
  }
}

class MockOmniEyeWorkflows implements OmniEyeWorkflowsAdapter {
  constructor(private readonly client: MockOmniEyeClient) {}

  async verifyUiConsistency(request: UiConsistencyRequest): Promise<UiConsistencyResult> {
    const baselineSnapshot = await this.client.capture({ tabId: 1 });
    const candidateSnapshot = await this.client.capture({ tabId: 2 });

    const diff = await this.client.compareSnapshots({
      baselineId: baselineSnapshot.id,
      candidateSnapshotId: candidateSnapshot.id,
    });

    const summary = `Compared ${request.baseline.url} to ${request.candidate.url}`;

    return {
      baselineSnapshot,
      candidateSnapshot,
      diff,
      baselineActions: [],
      candidateActions: [],
      diagnostics: [
        `baseline:${request.baseline.url}`,
        `candidate:${request.candidate.url}`,
      ],
      summary,
    };
  }
}

async function main(): Promise<void> {
  const client = new MockOmniEyeClient();
  const workflows = new MockOmniEyeWorkflows(client);

  const server = await createOmniEyeMcpServer({
    client,
    workflows,
    info: { name: "omni-eye-test-server", version: "0.0.1" },
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    try {
      await server.close?.();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise<void>(() => {
    /* keep process alive for stdin/stdout transport */
  });
}

main().catch((error) => {
  console.error("Mock MCP server failed", error);
  process.exit(1);
});
