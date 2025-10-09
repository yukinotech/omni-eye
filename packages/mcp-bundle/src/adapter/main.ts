import { createLogger } from "./logger";
import { NativeMessageReader, writeNativeMessage } from "./nativeIo";
import Fastify, { FastifyInstance } from "fastify";

const log = createLogger("Adapter2");

log?.info?.("Adapter script loaded");

const dataMap: Record<string, any> = {};

let fastify: FastifyInstance = undefined as any;

const handleExtensionEnvelope = (data: any) => {
  log?.info?.("handleExtensionEnvelope", data);
  const reqId = data?.reqId;
  dataMap[reqId] = data;
};

const getNativeResData = async (reqId: string) => {
  return new Promise((resolve, reject) => {
    const getData = () => {
      log?.info?.("getNativeResData start");
      setTimeout(() => {
        if (!dataMap[reqId]) {
          log?.info?.("getNativeResData to start again");
          getData();
        } else {
          const data = dataMap[reqId];
          log?.info?.("getNativeResData data ", data);
          dataMap[reqId] = undefined;
          resolve(data);
        }
      }, 1000);
    };

    getData();
  });
};

function createhttpServer() {
  fastify = Fastify({
    logger: false,
  });

  fastify.post("/api/common", async (request, reply) => {
    log?.info?.("request body", JSON.stringify(request?.body));
    // @ts-ignore
    const reqId = request?.body?.reqId;
    log?.info?.("reqId", reqId);
    // @ts-ignore
    writeNativeMessage(process.stdout, { ...request?.body });
    const data = await getNativeResData(reqId);
    log?.info?.("getNativeResData", data);
    reply.send(data);
  });

  // Run the server!
  fastify.listen({ port: 2231 }, function (err, address) {
    if (err) {
      log?.info?.("fastify err", err);
      process.exit(1);
    }
    // Server is now listening on ${address}
  });
}

function setupNativeMessaging() {
  try {
    process.stdin.resume();
    process.stdin.on("error", (error) => {
      log?.error?.("Native messaging stdin error", error);
    });
    process.stdout.on("error", (error) => {
      log?.error?.("Native messaging stdout error", error);
    });

    const reader = new NativeMessageReader(
      (data) => handleExtensionEnvelope(data),
      (error) => log?.error?.("Failed to parse native message", error),
    );

    process.stdin.on("data", (chunk: Buffer) => {
      log?.info?.("stdin data", chunk);
      reader.push(chunk);
    });

    process.stdin.on("close", () => {
      log?.info?.("Extension disconnected");
    });
  } catch (error) {
    log?.error?.("Failed to initialize native messaging", error);
  }
}

export function start() {
  setupNativeMessaging();
  createhttpServer();
}

if (require.main === module) {
  start();
}
