import { ensureId, Envelope, ErrorEnvelope, RequestEnvelope, isEnvelope } from "./shared/envelope";
import { Req } from "./type";

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

  nativePort.onMessage.addListener(async (msg) => {
    log("native Received message", msg);
    await relayRequestToContent(msg);
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

async function relayRequestToContent(data: Req) {
  if (!data?.cap) {
    sendToAdapter({ result: "请求无cap方法", status: "error", reqId: data.reqId });
    return;
  }

  if (data?.cap === "dom_query") {
    const tabData = await getTabData();
    console.log("tabData", tabData);
    sendToAdapter({ result: "dom_query命中", status: "success", reqId: data.reqId, tabData });
    return;
  }
  if (data?.cap === "dom_click") {
    sendToAdapter({ result: "dom_click命中", status: "success", reqId: data.reqId });
    return;
  }
}

function getTabData() {
  return new Promise<{ html: string; title: string; location: string } | null>((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      console.log("tabs", tabs);
      if (chrome.runtime.lastError) {
        log("Failed to query active tab", chrome.runtime.lastError.message);
        resolve(null);
        return;
      }

      const activeTab = tabs[0];
      if (!activeTab?.id) {
        log("No active tab found for DOM retrieval");
        resolve(null);
        return;
      }

      chrome.scripting.executeScript(
        {
          target: { tabId: activeTab.id },
          func: () => ({
            html:
              Array.from(document.querySelectorAll("#page"))?.[1]?.outerHTML ||
              document.documentElement.outerHTML,
            title: document.title,
            location: window.location.href,
          }),
        },
        (results) => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            log("Failed to execute DOM collection script", lastError.message);
            resolve(null);
            return;
          }

          const [injectionResult] = results ?? [];
          if (!injectionResult) {
            log("DOM collection script returned no results", activeTab.id);
            resolve(null);
            return;
          }

          resolve(
            injectionResult.result as {
              html: string;
              title: string;
              location: string;
            },
          );
        },
      );
    });
  });
}

function domClick() {
  
}

// function dispatchToTab(tabId: number, envelope: RequestEnvelope) {
//   chrome.tabs.sendMessage(tabId, envelope, (response) => {});
// }

// chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {});

connectNative();
