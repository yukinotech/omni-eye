import fs from "fs";
import net from "net";
import { hideBin } from "yargs/helpers";
import yargs from "yargs";
import { adapterSocketPath } from "../server-sdk";

interface StatusResult {
  socketPath: string;
  listening: boolean;
  error?: string;
}

async function probeAdapter(): Promise<StatusResult> {
  const socketPath = adapterSocketPath();

  const exists = process.platform === "win32" ? true : fs.existsSync(socketPath);
  if (!exists) {
    return { socketPath, listening: false, error: "socket path does not exist" };
  }

  return new Promise<StatusResult>((resolve) => {
    const socket = net.createConnection(socketPath, () => {
      socket.end();
      resolve({ socketPath, listening: true });
    });
    socket.on("error", (error) => {
      resolve({ socketPath, listening: false, error: error.message });
    });
  });
}

async function runStatus() {
  const result = await probeAdapter();
  if (result.listening) {
    console.log(`Adapter listening on ${result.socketPath}`);
  } else {
    console.log(`Adapter not available at ${result.socketPath}`);
    if (result.error) {
      console.log(`Reason: ${result.error}`);
    }
  }
}

export async function runCli(argv = hideBin(process.argv)) {
  await yargs(argv)
    .scriptName("mcp-bundle")
    .command(
      "status",
      "Check adapter socket status",
      () => {},
      async () => {
        await runStatus();
      }
    )
    .demandCommand(1)
    .help()
    .parseAsync();
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
