import fs from "fs";
import path from "path";

import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ZodRawShape } from "zod";

import { createLogger } from "../adapter/logger";
import { type EventEnvelope, type ResponseEnvelope } from "../mcp-core/envelope";

import { AdapterClient, AdapterClientError } from "./adapterClient";

interface ToolContentJson {
  type: "json";
  data: unknown;
}

interface ToolContentText {
  type: "text";
  text: string;
}

type ToolContent = ToolContentJson | ToolContentText;

interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

export const log = createLogger("mcp-server");

const TOOL_DEFINITIONS: Record<
  string,
  {
    description: string;
    inputSchema: Record<string, unknown>;
  }
> = {
  dom_query: {
    description: "Query DOM information from the Omni Eye browser extension.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
    },
  },
  dom_diff: {
    description: "Compute DOM diffs using the Omni Eye browser extension.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
    },
  },
};

type ToolDefinition = (typeof TOOL_DEFINITIONS)[string];

const SERVER_ID = process.env.MCP_SERVER_ID ?? "omni-eye";
const SERVER_VERSION = resolveVersion();

function resolveVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, "..", "..", "package.json");
    const raw = fs.readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw);
    if (pkg.version && typeof pkg.version === "string") {
      return pkg.version;
    }
  } catch (error) {
    log?.warn?.("Unable to determine package version", error);
  }
  return "0.0.0";
}

function toToolSuccess(envelope: ResponseEnvelope): ToolResult {
  log.info("toToolSuccess", envelope);
  const payload = envelope.payload ?? null;
  const meta = envelope.meta ? { ...envelope.meta } : undefined;
  const data = meta ? { payload, meta } : payload;
  return {
    content: [
      {
        type: "json",
        data,
      },
    ],
  };
}

function toToolError(error: unknown): ToolResult {
  log.error("toToolError", error);
  if (error instanceof AdapterClientError) {
    return {
      isError: true,
      content: [
        {
          type: "json",
          data: {
            code: error.code,
            message: error.message,
            retriable: error.retriable,
            retryAfterMs: error.retryAfterMs,
          },
        },
      ],
    };
  }

  if (error instanceof Error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: error.message,
        },
      ],
    };
  }

  return {
    isError: true,
    content: [
      {
        type: "text",
        text: String(error),
      },
    ],
  };
}

function determineToolRegistrar(server: McpServer) {
  return (name: string, definition: ToolDefinition, handler: ToolCallback<ZodRawShape>) => {
    server.registerTool(
      name,
      {
        description: definition.description,
        inputSchema: definition.inputSchema as ZodRawShape,
      },
      handler,
    );
  };
}

function registerTools(server: McpServer, client: AdapterClient) {
  const register = determineToolRegistrar(server);

  for (const [cap, definition] of Object.entries(TOOL_DEFINITIONS)) {
    const handler: any = async (input: any) => {
      try {
        const response = await client.sendRequest(cap, input);
        log.info("response");
        return toToolSuccess(response);
      } catch (error) {
        return toToolError(error);
      }
    };

    register(cap, definition, handler);
  }
}

function createServer(client: AdapterClient) {
  const server: any = new McpServer({
    name: "omni-eye",
    version: SERVER_VERSION,
    description: "Forward DOM capabilities to the Omni Eye extension via MCP adapter.",
  });
  registerTools(server, client);
  return server;
}

function sendServerNotification(server: McpServer, method: string, params: unknown) {
  log?.debug?.("Server instance does not expose a notification API", {
    method,
  });
}

function attachAdapterListeners(server: McpServer, client: AdapterClient) {
  client.on("connected", () => {
    sendServerNotification(server, "omni.eye/adapter_status", {
      status: "connected",
    });
  });

  client.on("disconnected", (error?: Error) => {
    sendServerNotification(server, "omni.eye/adapter_status", {
      status: "disconnected",
      message: error?.message,
    });
  });

  client.on("event", (envelope: EventEnvelope) => {
    sendServerNotification(server, "omni.eye/adapter_event", envelope.payload);
  });

  client.on("error", (error: Error) => {
    log?.warn?.("Adapter client error", error);
  });
}

let shuttingDown = false;

async function shutdown(client: AdapterClient) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await client.stop();
  } catch (error) {
    log?.warn?.("Error while stopping adapter client", error);
  }
}

function setupProcessHandlers(client: AdapterClient) {
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.on(signal, () => {
      void shutdown(client);
    });
  }

  process.on("exit", () => {
    if (!shuttingDown) {
      void client.stop();
    }
  });
}

export async function start() {
  log.info("init");
  const client = new AdapterClient({
    serverId: SERVER_ID,
    caps: Object.keys(TOOL_DEFINITIONS),
    version: SERVER_VERSION,
    logger: log,
  });

  const server = createServer(client);
  attachAdapterListeners(server, client);
  setupProcessHandlers(client);

  try {
    await client.start();
  } catch (error) {
    log?.warn?.("Adapter not yet available; will keep retrying", error);
  }

  const transport = new StdioServerTransport();
  try {
    await server.connect(transport);
  } catch (error) {
    await shutdown(client);
    throw error;
  }
}
