import fs from "fs";
import path from "path";
import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z, ZodRawShape } from "zod";
import axios, { AxiosInstance } from "axios";
import { randomUUID } from "crypto";
import { createLogger } from "../adapter/logger";
import { Req } from "../type/req";
// @ts-ignore
import unfluff from "unfluff";

const axiosClient = axios.create({
  baseURL: "http://localhost:2231",
});

export const log = createLogger("Mcp Server");

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

function registerTools(server: McpServer, client: AxiosInstance) {
  const handler: any = async (cap: string, payload?: any) => {
    try {
      const reqId = crypto.randomUUID();
      log.info("尝试调用:", cap, payload);
      log.info("尝试调用reqid:", reqId);
      const response = await client.post("/api/common", { cap, payload, reqId } as Req);
      log.info("尝试调用结果:", response.data);
      // const result = unfluff(response.data?.tabData?.html, "zh"); // 指定语言有助于分词
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return error;
    }
  };

  server.registerTool(
    "dom_query",
    {
      description: "查询页面信息",
    },
    (args, extra) => handler("dom_query"),
  );
  server.registerTool(
    "dom_click",
    {
      description: "点击dom元素",
      inputSchema: {
        selector: z.string().min(1).describe("CSS 选择器（如：.btn.primary 或 #submit）"),
      },
    },
    (args, extra) => {
      log.info("dom_click", args);
      return handler("dom_click", args);
    },
  );
}

function createServer() {
  const server: any = new McpServer({
    name: "omni-eye",
    version: SERVER_VERSION,
    description: "Forward DOM capabilities to the Omni Eye extension via MCP adapter.",
  });
  registerTools(server, axiosClient);
  return server;
}

export async function start() {
  log.info("server init");
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
