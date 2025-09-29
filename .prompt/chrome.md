

# 0) 背景与目标

* **场景**：Codex/Agent 通过本地 **MCP server** 获取“查看网页/对比/注入”等能力；这些能力由 **Chrome Extension** 实际执行。
* **桥接**：使用 **Native Messaging Host (Adapter)** 作为扩展与本地的桥，Adapter 与 MCP server 通过 **本地 socket/pipe** 通信（统一“域名”约定）。
* **多实例**：一台机器可以启动多个独立 MCP server 进程，彼此隔离。
* **安装体验**：`mcp-server` npm 包安装时用 `postinstall` 自动写入 **Native Messaging manifest**，避免用户多次手动配置。
* **Monorepo**：`mcp-server` 与 `adapter` 放在同一子仓（同包），便于一次发布；`extension` 独立包。


---

# 1) Monorepo 布局

```
repo/
├─ package.json                      # 使用 pnpm/yarn workspaces
├─ packages/
│  ├─ mcp-bundle/                    # ★ 统一对外包：包含 adapter + mcp-core + server SDK + postinstall
│  │  ├─ src/
│  │  │  ├─ adapter/                 # Native Messaging Host Adapter 源码
│  │  │  ├─ mcp-core/                # 协议/类型/工具（共享）
│  │  │  ├─ server-sdk/              # MCP server 侧的 SDK（连接/注册/心跳/请求）
│  │  │  └─ cli/                     # 可选：本地调试 CLI
│  │  ├─ bin/
│  │  │  └─ mcp-adapter.js           # manifest.path 指向的可执行入口
│  │  ├─ scripts/
│  │  │  ├─ register-native-host.js  # postinstall：写 manifest（跨平台）
│  │  │  └─ unregister-native-host.js# preuninstall：清理
│  │  ├─ package.json                # 包含 "bin", "postinstall", "preuninstall"
│  │  └─ README.md
│  └─ extension/                     # Chrome MV3 扩展
│     ├─ src/
│     │  ├─ background.ts            # 连接 Native Host，转发消息至 content
│     │  ├─ content.ts               # 执行 DOM/截图/对比等
│     │  └─ ui/                      # popup/options
│     ├─ manifest.json               # MV3
│     └─ package.json
└─ README.md                         # 总览
```

> 说明：对外只让用户安装 **一个 npm 包 `mcp-bundle`**（内含 Adapter、协议和 server SDK）。MCP 的各业务 server（DOM diff、OCR…）可在其它仓，但统一通过 **server-sdk** 接入 Adapter 的 socket/pipe。

---

# 2) 安装与运行

## 2.1 用户安装（两步）

1. **Chrome Web Store 安装扩展**（packages/extension 发布到商店）。
2. **安装 npm 包**：

```bash
npm i -g mcp-bundle
# postinstall 自动写入 Native Messaging manifest，path 指向 bin/mcp-adapter.js
```

> 之后扩展启动时 `chrome.runtime.connectNative("mcp_adapter")` → Chrome 按 manifest.path 启动 Adapter 进程。

## 2.2 postinstall 自动写 manifest（跨平台要点）

* 通过 `npm bin -g` 解析全局 bin 路径，定位 `mcp-adapter`（Win 上是 `.cmd`）。
* 写入 manifest 至平台规定位置，并填入 **你的扩展 ID**（allowed_origins）。
* Windows 写注册表 `HKCU\Software\Google\Chrome\NativeMessagingHosts\mcp_adapter` → 值为 manifest 完整路径。
* `preuninstall` 清理 manifest/注册表。

---

# 3) 通信拓扑与“域名”（socket/pipe 命名）

```
Codex → MCP Server (N 个独立进程)
MCP Server ↔ Adapter  (本地 socket/pipe，统一命名)
Adapter ↔ Extension   (Native Messaging: stdin/stdout + 4B length + JSON)
Extension ↔ Web Page  (content script 实操)
```

## 3.1 统一 socket/pipe 名（“本地域名”）

* Linux/macOS（Unix Domain Socket）：`/tmp/mcp-adapter.sock`（或 `$XDG_RUNTIME_DIR/mcp-adapter.sock`）
* Windows（Named Pipe）：`\\.\pipe\mcp-adapter`

**约定**：**只监听一个固定名称**（Adapter 作为服务端监听）。

* MCP server 初次启动 → 按约定去连接该“域名”；若未监听（浏览器/扩展未开）则指数退避重试。
* 一旦 Adapter 被扩展拉起开始监听，MCP server 立即连上并 `REGISTER`。

> 这样 MCP server 生命周期独立，不依赖 Adapter 常驻；Adapter 作为“短命桥接器”。

---

# 4) 消息协议（统一 JSON Envelope）

所有链路（MCP↔Adapter / Adapter↔Extension）统一 JSON 信封，便于透传与调试。**长度前缀仅用于 Native Messaging 与 stdin/stdout，不用于 socket。**

```ts
type Envelope =
  | Request
  | Response
  | ErrorMsg
  | Register
  | Heartbeat
  | Event;

interface Base {
  id?: string;       // 请求/响应关联；Register/Heartbeat 可无 id
  type: "REQUEST" | "RESPONSE" | "ERROR" | "REGISTER" | "HEARTBEAT" | "EVENT";
  source?: "mcp" | "adapter" | "extension";
  target?: "adapter" | "mcp" | "extension";
  cap?: string;      // 能力标签，如 "dom.diff" | "dom.query" | "page.screenshot"
  meta?: { ts?: number; traceId?: string; serverId?: string; version?: string };
}

interface Request extends Base {
  id: string;
  type: "REQUEST";
  cap: string;
  payload: any;
}
interface Response extends Base {
  id: string;
  type: "RESPONSE";
  payload: any;
}
interface ErrorMsg extends Base {
  id?: string;
  type: "ERROR";
  error: { code: string; message: string; retriable?: boolean; retryAfterMs?: number };
}
interface Register extends Base {
  type: "REGISTER";
  payload: { serverId: string; caps: string[]; version: string };
}
interface Heartbeat extends Base {
  type: "HEARTBEAT";
  payload: { serverId: string; load?: number };
}
interface Event extends Base {
  type: "EVENT";
  payload: any;
}
```

**标准错误码建议**：

* `browser_unavailable`（扩展未连/浏览器未开）
* `cap_not_found`（Adapter 未发现支持该 cap 的扩展侧实现）
* `mcp_unavailable`（Adapter 未连上某个 MCP）
* `timeout` / `bad_request` / `internal`

---

# 5) 路由与多路复用

* **Adapter 持有连接表**：

  * `mcpConnections: Map<serverId, Socket>`
  * `extensionPort: NativePort | null`
* **能力注册表**：

  * `capIndex: Map<cap, Set<serverId>>`（主要用于上行？你也可在 Adapter 只做**下行**：MCP 请求“浏览器功能”时转给扩展；反向场景可按需支持）
* **请求关联**：Adapter 为每个请求生成 `id`，并保存 `pending.set(id, originSocket)`，响应后删除。
* **并发**：全链路无共享状态，靠 `id` 关联，天然多路复用。

---

# 6) 生命周期与时序（首次连接）

```
[MCP server 启动]
  └─ 连接 /tmp/mcp-adapter.sock（失败→重试）
[扩展启动 → Chrome 拉起 Adapter]
  └─ Adapter 监听 /tmp/mcp-adapter.sock
[MCP→Adapter]
  └─ REGISTER {serverId, caps, version}
[扩展↔Adapter]
  └─ Native Messaging 建立；扩展 ready
[MCP 发送 REQUEST(cap="dom.diff")]
  └─ Adapter 转发给扩展
[扩展执行并返回]
  └─ Adapter 将 RESPONSE 回给发起的 MCP
```

**无扩展时**：Adapter 不在监听 → MCP 连接不上 → 返回上游“浏览器未就绪”或本地排队等待（可选）。

---

# 7) 关键文件与样例

## 7.1 `packages/mcp-bundle/package.json`（节选）

```json
{
  "name": "mcp-bundle",
  "version": "1.0.0",
  "bin": { "mcp-adapter": "./bin/mcp-adapter.js" },
  "scripts": {
    "postinstall": "node ./scripts/register-native-host.js",
    "preuninstall": "node ./scripts/unregister-native-host.js"
  }
}
```

## 7.2 manifest（postinstall 生成，节选）

```json
{
  "name": "mcp_adapter",
  "description": "Native Host Adapter for MCP",
  "path": "/ABS/PATH/TO/bin/mcp-adapter",   // 动态解析 npm -g bin
  "type": "stdio",
  "allowed_origins": ["chrome-extension://<EXTENSION_ID>/"]
}
```

## 7.3 跨平台 socket 名工具（server-sdk）

```ts
// packages/mcp-bundle/src/server-sdk/socketName.ts
import os from "os";
export function adapterSocketPath() {
  if (process.platform === "win32") return `\\\\.\\pipe\\mcp-adapter`;
  const dir = process.env.XDG_RUNTIME_DIR || "/tmp";
  return `${dir}/mcp-adapter.sock`;
}
```

## 7.4 Adapter 入口（最小骨架）

```ts
// packages/mcp-bundle/bin/mcp-adapter.js
#!/usr/bin/env node
require('../dist/adapter/main').start();
```

```ts
// packages/mcp-bundle/src/adapter/main.ts
import net from "net";
import { adapterSocketPath } from "../server-sdk/socketName";
import { readNativeMsg, writeNativeMsg } from "./native-io"; // 4B length helpers

let extAlive = false;
const mcpSockets = new Map<string, net.Socket>(); // serverId -> socket

export function start() {
  // 1) 连接扩展（Native Messaging）：读写 stdin/stdout
  setupNativeMessaging();

  // 2) 监听本地 socket，供 MCP server 连接
  const sock = adapterSocketPath();
  safeUnlink(sock); // 先删旧 sock 文件（类 Unix）
  const server = net.createServer(handleMcpConn);
  server.listen(sock, () => log("Adapter listening:", sock));
}

function handleMcpConn(s: net.Socket) {
  let serverId: string | null = null;
  s.on("data", buf => {
    for (const msg of decodeStream(buf)) {
      if (msg.type === "REGISTER") {
        serverId = msg.payload.serverId;
        mcpSockets.set(serverId!, s);
        // 可通知扩展有新能力（可选）
      } else if (msg.type === "REQUEST") {
        if (!extAlive) return sendErrorToMcp(s, msg.id, "browser_unavailable", "Extension not connected");
        // 透传给扩展（写 stdout）
        writeNativeMsg({ ...msg, source: "mcp", target: "extension" });
      }
    }
  });
  s.on("close", () => { if (serverId) mcpSockets.delete(serverId); });
}

function setupNativeMessaging() {
  process.stdin.on("readable", () => {
    let msg; while ((msg = readNativeMsg(process.stdin)) !== null) {
      extAlive = true;
      if (msg.type === "RESPONSE" || msg.type === "ERROR") {
        // 找回请求来源的 MCP 按 id（需要你在发 REQUEST 时记录 pending 表）
        const s = findPendingOwner(msg.id);
        s?.write(encode(msg));
      } else if (msg.type === "REQUEST") {
        // 如果扩展会向 MCP 请求，则在此转发
        const s = pickMcpByCap(msg.cap);
        if (!s) writeNativeMsg({ type: "ERROR", id: msg.id, error: { code: "mcp_unavailable", message: "No MCP for cap" }});
        else s.write(encode(msg));
      }
    }
  });
  process.stdin.on("end", () => { extAlive = false; });
}
```

> 注：省略了 `decodeStream/encode/pending map` 等细节；真实实现需加上 `id` → socket 的 `pending` 路由表与 back-pressure 控制。

## 7.5 MCP server 侧最小骨架

```ts
// packages/mcp-bundle/src/server-sdk/mcpClient.ts
import net from "net";
import { adapterSocketPath } from "./socketName";
import { encode, decodeStream } from "./framing";

export class McpClient {
  private sock!: net.Socket;
  constructor(private serverId: string, private caps: string[]) {}

  async connect() {
    return new Promise<void>((resolve, reject) => {
      this.sock = net.createConnection(adapterSocketPath(), () => {
        this.sock.write(encode({
          type: "REGISTER",
          payload: { serverId: this.serverId, caps: this.caps, version: "1.0.0" }
        }));
        resolve();
      });
      this.sock.on("data", buf => {
        for (const msg of decodeStream(buf)) this.onMessage(msg);
      });
      this.sock.on("error", reject);
    });
  }
  request(id: string, cap: string, payload: any) {
    this.sock.write(encode({ id, type: "REQUEST", cap, payload, source: "mcp", target: "extension" }));
  }
  onMessage(msg: any) {
    // 处理 RESPONSE/ERROR
  }
}
```

## 7.6 扩展 background（与 Adapter 对接）

```ts
// packages/extension/src/background.ts
let port: chrome.runtime.Port | null = null;

function connectNative() {
  port = chrome.runtime.connectNative("mcp_adapter");
  port.onMessage.addListener(onFromAdapter);
  port.onDisconnect.addListener(() => { port = null; /* 可重连策略 */});
}
connectNative();

function onFromAdapter(msg: any) {
  if (msg.type === "REQUEST") {
    // 转给 content 执行能力
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      chrome.tabs.sendMessage(tabs[0].id!, msg, (res) => {
        port?.postMessage({ id: msg.id, type: "RESPONSE", payload: res, source: "extension", target: "mcp" });
      });
    });
  }
}
```

## 7.7 扩展 content（执行网页能力）

```ts
// packages/extension/src/content.ts
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "REQUEST" && msg.cap === "dom.diff") {
    // 执行 DOM diff（示意）
    const result = { patch: [], confidence: 0.9 };
    sendResponse(result);
  }
  return true; // 异步响应
});
```

---

# 8) 版本协商与健康检查

* **版本协商**：`REGISTER.meta.version` 对齐；Extension 与 Adapter 首包交换 `schemaVersion`，不兼容直接 `ERROR{code:"version_mismatch"}`。
* **心跳**：MCP 定期 `HEARTBEAT{load}`；Adapter 若长时间无心跳 → 标记该 `serverId` 不可用。
* **背压**：Adapter 为每条下游连接维护队列长度，超阈值返回 `ERROR{code:"overloaded", retriable:true, retryAfterMs}`。

---

# 9) 安全与权限

* **Native Messaging manifest** 必须限定 `allowed_origins` 为你的扩展 ID。
* **最小权限**：扩展只申请必要的 host 权限和 `scripting`/`activeTab`。
* **输入校验**：Adapter 校验来自 MCP 的 `cap/payload` schema，限制消息体大小。
* **Socket 存取**：Unix socket 设置 0600；Windows pipe 设定 ACL，仅当前用户可访问。

---

# 10) 日志与可观测性

* 统一结构化日志字段：`{ts, level, comp, traceId, id, type, cap, serverId, durMs}`
* Adapter 支持 `--log-level` 与 `--log-file`；必要时在 `/tmp/mcp-adapter.log` 追加。
* 提供 `mcp-bundle` 的 `cli status` 命令：列出已注册 MCP、心跳时间、负载、扩展连接状态。

---

# 11) 开发与发布

* **dev**：`pnpm -w dev` 并发跑 adapter、虚拟 MCP、extension（`chrome --load-extension=...`）。
* **build**：adapter 与 SDK 用 tsup/esbuild 打包为 cjs；extension 用 Vite/rollup。
* **publish**：只对外发布 `mcp-bundle`（包含 postinstall）；extension 走商店渠道。


