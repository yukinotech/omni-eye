import { ensureId, Envelope, ErrorEnvelope, RequestEnvelope, isEnvelope } from "./shared/envelope";

const HOST_NAME = "omni_eye_mcp_adapter";
const EXT_CAPS = ["dom.diff", "dom.query", "page.screenshot"];

let nativePort: chrome.runtime.Port | null = null;
let reconnectDelay = 500;
const MAX_RECONNECT_DELAY = 10_000;

const runtimePending = new Map<string, (envelope: Envelope) => void>();

function log(...args: unknown[]) {
  console.log("[omni-eye]", ...args);
}

function connectNative() {
  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME);
  } catch (error) {
    log("Failed to connect native host", error);
    scheduleReconnect();
    return;
  }

  reconnectDelay = 500;
  log("Connected to native host");

  nativePort.onMessage.addListener((msg) => {
    log("native Received message", msg);
    relayRequestToContent(msg);
  });

  nativePort.onDisconnect.addListener(() => {
    const lastError = chrome.runtime.lastError;
    if (lastError) {
      log("Native host disconnect: ", lastError.message);
    } else {
      log("Native host disconnected");
    }
    nativePort = null;
    scheduleReconnect();
  });

  sendToAdapter({
    type: "REGISTER",
    source: "extension",
    target: "adapter",
    payload: {
      serverId: "extension",
      caps: EXT_CAPS,
      version: chrome.runtime.getManifest().version,
    },
  });
}

function scheduleReconnect() {
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  setTimeout(() => connectNative(), reconnectDelay);
}

function sendToAdapter(data: any) {
  if (!nativePort) {
    log("Adapter port unavailable. Dropping message", data);
    return;
  }
  nativePort.postMessage(data);
}

function relayRequestToContent(data: any) {
  if (!data?.cap) {
    sendToAdapter({ result: "请求无cap方法", status: "error", reqId: data.reqId });
    return;
  }

  if (data?.cap === "dom_query") {
    sendToAdapter({ result: "dom_query命中", status: "success", reqId: data.reqId });
    return;
  }
}

function dispatchToTab(tabId: number, envelope: RequestEnvelope) {
  chrome.tabs.sendMessage(tabId, envelope, (response) => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {});

connectNative();
