本项目是一个 monorepo，包含两个核心模块：

packages/chrome-extension：Chrome 插件，用于在浏览器中读取 DOM、tab 信息，并执行点击、滚动、输入等操作。

packages/mcp-server：作为 agent 的服务端，可以下发指令给 Chrome 插件执行，并接收回传信息。

Chrome 插件的职责：执行浏览器端操作，读取信息，截图并回传。
MCP Server 的职责：解析 prompt，生成操作指令，组织任务流程，并对比结果。

场景和能力拆解：

验证迁移前后 UI 一致性

Chrome 插件：支持 DOM 读取、截图、元素提取。

MCP Server：执行 DOM 和截图对比，输出差异报告。

打开迁移后的页面

Chrome 插件：支持打开指定 URL，例如 localhost:8080/xxx。

MCP Server：下发“打开页面”的指令。

打开迁移前的页面

Chrome 插件：同样支持打开指定 URL。

MCP Server：下发“打开旧页面”的指令。

基于 prompt 执行页面操作（点击、滑动、输入）

Chrome 插件：提供操作 API，支持点击元素、滚动、输入框填值。

MCP Server：解析 prompt，生成操作序列，下发给插件。

比较页面渲染是否一致

Chrome 插件：提供 DOM 抓取和截图能力。

MCP Server：执行 DOM diff 和截图比对（像素 diff 或感知 diff）。

操作表单按钮并截图对比

Chrome 插件：支持表单提交、按钮点击、截图功能。

MCP Server：保存截图并对比新旧页面结果。

架构设计：

chrome-extension：

消息通道：与 MCP Server 建立通信（WebSocket 或 Native Messaging）。

浏览器操作模块：打开/关闭 tab，执行 DOM 操作，抓取 DOM，截图。

指令解析器：接收 MCP Server 的指令并执行。

结果回传模块：将 DOM、截图或执行结果返回给 MCP Server。

mcp-server：

指令生成模块：将业务 prompt 翻译为操作序列。

对比引擎：DOM diff，截图 diff。

任务编排器：组织场景任务流程（打开页面 -> 执行操作 -> 抓取结果 -> 对比）。

通信模块：与 Chrome 插件通信，下发指令并接收结果。

任务映射（场景 -> 能力）：

打开页面：Chrome 插件支持打开 URL；MCP Server 下发 URL 打开指令。

点击/滑动/输入：Chrome 插件提供 DOM 操作 API；MCP Server 负责解析 prompt 生成操作序列。

读取 DOM：Chrome 插件负责 DOM 抓取；MCP Server 执行比对和分析。

截图：Chrome 插件提供截图能力；MCP Server 负责 diff 和结果存档。

UI 对比：Chrome 插件提供 DOM 和截图；MCP Server 负责分析。

表单操作：Chrome 插件执行操作并截图；MCP Server 验证结果并比对。

总结：
Chrome Extension 负责执行和回传。
MCP Server 负责编排和分析。


完成上述功能