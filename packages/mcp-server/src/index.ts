import { ExtensionBridge } from "./bridge.js";
import { OmniEyeClient, type CaptureParams, type NavigateParams } from "./client.js";
import { OmniEyeWorkflows, type UiConsistencyRequest } from "./workflows.js";
import {
  normaliseAction,
  normaliseSelector,
  parseActionsFromPrompt,
  type PromptParseResult,
} from "./prompt-parser.js";
import type { ElementSelector, PageAction, WaitCondition } from "./messages.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export type OmniEyeClientAdapter = Pick<
  OmniEyeClient,
  "navigate" | "capture" | "performActions" | "extractDom" | "compareSnapshots"
>;

export type OmniEyeWorkflowsAdapter = Pick<OmniEyeWorkflows, "verifyUiConsistency">;

export interface CreateOmniEyeMcpServerOptions {
  client: OmniEyeClientAdapter;
  workflows: OmniEyeWorkflowsAdapter;
  info?: {
    name: string;
    version: string;
  };
}

export async function createOmniEyeMcpServer(
  options: CreateOmniEyeMcpServerOptions,
): Promise<McpServer> {
  const server = new McpServer(options.info ?? { name: "omni-eye", version: "0.1.0" });

  registerOmniEyeTools(server, options.client, options.workflows);

  return server;
}

async function start(): Promise<void> {
  const bridge = new ExtensionBridge();

  bridge.on("open", () => {
    console.log("[omni-eye:mcp] waiting for extension connection on ws://localhost:7337");
  });

  bridge.on("snapshot", (snapshot) => {
    console.log("[omni-eye:mcp] snapshot received", {
      id: snapshot.id,
      url: snapshot.url,
      title: snapshot.title,
    });
  });

  await startMcpServer(bridge);
}

async function startMcpServer(bridge: ExtensionBridge): Promise<void> {
  try {
    const client = new OmniEyeClient(bridge);
    const workflows = new OmniEyeWorkflows(client);
    const server = await createOmniEyeMcpServer({ client, workflows });
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    console.warn("[omni-eye:mcp] Failed to start Model Context Protocol server", error);
    console.warn(
      "[omni-eye:mcp] Running in bridge-only mode. Install @modelcontextprotocol/sdk to enable MCP support.",
    );

    await new Promise<void>(() => {
      /* keep process alive */
    });
  }
}

function registerOmniEyeTools(
  server: McpServer,
  client: OmniEyeClientAdapter,
  workflows: OmniEyeWorkflowsAdapter,
): void {
  server.tool(
    "open_page",
    {
      description: "Open a web page in the browser via the Omni Eye extension",
      inputSchema: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string" },
          tabId: { type: "number" },
          newTab: { type: "boolean" },
          waitFor: waitConditionSchema,
          timeoutMs: { type: "number" },
        },
      },
    },
    async (input: Partial<NavigateParams> & { url: string }) => {
      const waitFor = normalizeWaitConditionInput(input.waitFor);
      const result = await client.navigate({
        url: input.url,
        tabId: input.tabId,
        newTab: input.newTab,
        waitFor,
        timeoutMs: input.timeoutMs,
      });

      return { type: "json", value: result };
    },
  );

  server.tool(
    "capture_snapshot",
    {
      description: "Capture the active browser tab DOM and screenshot",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "number" },
          includeScreenshot: { type: "boolean" },
          storeSnapshot: { type: "boolean" },
          requestId: { type: "string" },
        },
      },
    },
    async (input: CaptureParams) => {
      const snapshot = await client.capture({
        tabId: input.tabId,
        includeScreenshot: input.includeScreenshot,
        storeSnapshot: input.storeSnapshot,
        requestId: input.requestId,
      });

      return { type: "json", value: snapshot };
    },
  );

  server.tool(
    "perform_actions",
    {
      description: "Execute a sequence of page actions derived from a prompt or structured array",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "number" },
          prompt: { type: "string" },
          actions: {
            type: "array",
            items: actionSchema,
          },
          captureSnapshot: { type: "boolean" },
          captureScreenshot: { type: "boolean" },
          storeSnapshot: { type: "boolean" },
        },
      },
    },
    async (input: PerformActionsInput) => {
      const diagnostics: string[] = [];
      let actions: PageAction[] | undefined;

      if (Array.isArray(input.actions) && input.actions.length > 0) {
        const normalised = input.actions
          .map((entry) => normaliseAction(entry))
          .filter((entry): entry is PageAction => Boolean(entry));

        if (normalised.length !== input.actions.length) {
          diagnostics.push("Some structured actions were ignored because they were malformed");
        }

        actions = normalised;
      }

      if ((!actions || actions.length === 0) && typeof input.prompt === "string") {
        const parsed: PromptParseResult = parseActionsFromPrompt(input.prompt);
        actions = parsed.actions;
        diagnostics.push(...parsed.diagnostics);
      }

      if (!actions || actions.length === 0) {
        throw new Error("No executable actions derived from prompt or structured input");
      }

      const response = await client.performActions({
        tabId: input.tabId,
        actions,
        options: {
          captureSnapshot: input.captureSnapshot,
          captureScreenshot: input.captureScreenshot,
          storeSnapshot: input.storeSnapshot,
        },
      });

      return {
        type: "json",
        value: {
          results: response.results,
          snapshot: response.snapshot,
          screenshot: response.screenshot,
          diagnostics,
        },
      };
    },
  );

  server.tool(
    "extract_dom",
    {
      description:
        "Extract DOM information such as HTML, text, and attributes from the active tab",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "number" },
          selector: selectorSchema,
          includeHtml: { type: "boolean" },
          includeText: { type: "boolean" },
          includeAttributes: { type: "boolean" },
          includeComputedStyles: { type: "boolean" },
          maxElements: { type: "number" },
        },
      },
    },
    async (input: { tabId?: number } & Record<string, unknown>) => {
      const extraction = {
        selector: normalizeSelectorInput(input.selector),
        includeHtml: input.includeHtml as boolean | undefined,
        includeText: input.includeText as boolean | undefined,
        includeAttributes: input.includeAttributes as boolean | undefined,
        includeComputedStyles: input.includeComputedStyles as boolean | undefined,
        maxElements: typeof input.maxElements === "number" ? input.maxElements : undefined,
      };

      const result = await client.extractDom({
        tabId: input.tabId,
        extraction,
      });

      return { type: "json", value: result };
    },
  );

  server.tool(
    "compare_snapshots",
    {
      description: "Compare a stored baseline snapshot against a candidate snapshot or raw HTML",
      inputSchema: {
        type: "object",
        required: ["baselineId"],
        properties: {
          baselineId: { type: "string" },
          candidateSnapshotId: { type: "string" },
          candidateHtml: { type: "string" },
        },
      },
    },
    async (input: {
      baselineId: string;
      candidateSnapshotId?: string;
      candidateHtml?: string;
    }) => {
      const diff = await client.compareSnapshots({
        baselineId: input.baselineId,
        candidateSnapshotId: input.candidateSnapshotId,
        candidateHtml: input.candidateHtml,
      });

      return { type: "json", value: diff };
    },
  );

  server.tool(
    "verify_ui_consistency",
    {
      description:
        "Navigate to baseline and candidate URLs, perform optional actions, capture snapshots, and diff the results",
      inputSchema: {
        type: "object",
        required: ["baseline", "candidate"],
        properties: {
          reuseTab: { type: "boolean" },
          baseline: pageSetupSchema,
          candidate: pageSetupSchema,
        },
      },
    },
    async (input: UiConsistencyRequest) => {
      const request: UiConsistencyRequest = {
        reuseTab: input.reuseTab,
        baseline: {
          url: input.baseline.url,
          actionsPrompt: input.baseline.actionsPrompt,
          waitFor: normalizeWaitConditionInput(input.baseline.waitFor),
        },
        candidate: {
          url: input.candidate.url,
          actionsPrompt: input.candidate.actionsPrompt,
          waitFor: normalizeWaitConditionInput(input.candidate.waitFor),
        },
      };

      const result = await workflows.verifyUiConsistency(request);
      return { type: "json", value: result };
    },
  );
}

const selectorSchema = {
  type: "object",
  properties: {
    css: { type: "string" },
    text: { type: "string" },
    exactText: { type: "boolean" },
    role: { type: "string" },
    attributes: {
      type: "object",
      additionalProperties: { type: "string" },
    },
    index: { type: "number" },
  },
} as const;

const waitConditionSchema = {
  type: "object",
  properties: {
    selector: selectorSchema,
    strategy: { type: "string", enum: ["exists", "visible"] },
    timeoutMs: { type: "number" },
    pollIntervalMs: { type: "number" },
  },
} as const;

const actionSchema = {
  type: "object",
  properties: {
    type: { type: "string" },
    selector: selectorSchema,
    value: { type: "string" },
    button: { type: "string" },
    clickCount: { type: "number" },
    delayMs: { type: "number" },
    replace: { type: "boolean" },
    focus: { type: "boolean" },
    x: { type: "number" },
    y: { type: "number" },
    behavior: { type: "string" },
    condition: {
      type: "object",
      properties: {
        selector: selectorSchema,
        strategy: { type: "string" },
        timeoutMs: { type: "number" },
        pollIntervalMs: { type: "number" },
      },
    },
  },
} as const;

const pageSetupSchema = {
  type: "object",
  required: ["url"],
  properties: {
    url: { type: "string" },
    actionsPrompt: { type: "string" },
    waitFor: waitConditionSchema,
  },
} as const;

type PerformActionsInput = {
  tabId?: number;
  prompt?: string;
  actions?: unknown[];
  captureSnapshot?: boolean;
  captureScreenshot?: boolean;
  storeSnapshot?: boolean;
};

function normalizeSelectorInput(value: unknown): ElementSelector | undefined {
  return normaliseSelector(value);
}

function normalizeWaitConditionInput(value: unknown): WaitCondition | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const selector = normalizeSelectorInput((value as { selector?: unknown }).selector);
  return {
    selector,
    strategy: (value as { strategy?: WaitCondition["strategy"] }).strategy,
    timeoutMs: (value as { timeoutMs?: number }).timeoutMs,
    pollIntervalMs: (value as { pollIntervalMs?: number }).pollIntervalMs,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((error) => {
    console.error("[omni-eye:mcp] fatal error", error);
    process.exit(1);
  });
}
