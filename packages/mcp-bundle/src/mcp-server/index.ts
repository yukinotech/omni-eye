import { log, start } from "./server";

export { start };

if (require.main === module) {
  start().catch((error) => {
    log?.error?.("MCP server failed to start", error);
    console.log("error: ", error);
    process.exitCode = 1;
  });
}
