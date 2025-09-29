import { ensureId, Envelope, ErrorEnvelope, RequestEnvelope, isEnvelope } from "./shared/envelope";

const HOST_NAME = "mcp_adapter";
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
    if (isEnvelope(msg)) {
      handleAdapterEnvelope(msg);
    } else {
      log("Received non-envelope message", msg);
    }
  });

  nativePort.onDisconnect.addListener(() => {
    const lastError = chrome.runtime.lastError;
    if (lastError) {
      log("Native host disconnect", lastError.message);
    } else {
      log("Native host disconnected");
    }
    nativePort = null;
    scheduleReconnect();
  });

  sendRegister();
}

function scheduleReconnect() {
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  setTimeout(() => connectNative(), reconnectDelay);
}

function sendRegister() {
  sendToAdapter({
    type: "REGISTER",
    source: "extension",
    target: "adapter",
    payload: {
      serverId: "extension",
      caps: EXT_CAPS,
      version: chrome.runtime.getManifest().version
    }
  });
}

function sendToAdapter(envelope: Envelope) {
  if (!nativePort) {
    log("Adapter port unavailable. Dropping message", envelope);
    return;
  }
  nativePort.postMessage(envelope);
}

function sendErrorToAdapter(id: string, code: string, message: string) {
  const errorEnvelope: ErrorEnvelope = {
    id,
    type: "ERROR",
    source: "extension",
    target: "mcp",
    error: { code, message }
  };
  sendToAdapter(errorEnvelope);
}

function relayRequestToContent(envelope: RequestEnvelope) {
  const chosenTabId = envelope.meta?.tabId;
  if (typeof chosenTabId === "number") {
    dispatchToTab(chosenTabId, envelope);
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs.find((t) => typeof t.id === "number");
    if (!tab || typeof tab.id !== "number") {
      sendErrorToAdapter(envelope.id, "browser_unavailable", "No active tab available for request");
      return;
    }
    dispatchToTab(tab.id, envelope);
  });
}

function dispatchToTab(tabId: number, envelope: RequestEnvelope) {
  chrome.tabs.sendMessage(tabId, envelope, (response) => {
    const lastError = chrome.runtime.lastError;
    if (lastError) {
      sendErrorToAdapter(envelope.id, "browser_unavailable", lastError.message || "Unable to reach tab");
      return;
    }

    if (response && typeof response === "object" && "error" in response) {
      const err = response.error as { code: string; message: string };
      sendErrorToAdapter(envelope.id, err.code ?? "internal", err.message ?? "Content script error");
      return;
    }

    sendToAdapter({
      id: envelope.id,
      type: "RESPONSE",
      source: "extension",
      target: "mcp",
      payload: response ?? null,
      meta: {
        ...(envelope.meta ?? {}),
        tabId
      }
    });
  });
}

function handleAdapterEnvelope(envelope: Envelope) {
  if (envelope.id && runtimePending.has(envelope.id)) {
    const responder = runtimePending.get(envelope.id)!;
    runtimePending.delete(envelope.id);
    responder(envelope);
    return;
  }

  switch (envelope.type) {
    case "REQUEST":
      relayRequestToContent(envelope);
      break;
    case "EVENT":
      broadcastEvent(envelope);
      break;
    case "ERROR":
    case "RESPONSE":
      log("Received response without pending runtime requester", envelope);
      break;
    case "REGISTER":
    case "HEARTBEAT":
      log("Adapter signal", envelope);
      break;
  }
}

function broadcastEvent(envelope: Envelope) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (typeof tab.id === "number") {
        chrome.tabs.sendMessage(tab.id, envelope, () => {
          // ignore errors from tabs without the content script
          void chrome.runtime.lastError;
        });
      }
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isEnvelope(message) || message.type !== "REQUEST") {
    return false;
  }

  if (!nativePort) {
    sendResponse({ error: { code: "browser_unavailable", message: "Adapter not connected" } });
    return false;
  }

  const id = ensureId(message, crypto.randomUUID());
  const meta = {
    ...(message.meta ?? {}),
    tabId: sender.tab?.id
  };

  runtimePending.set(id, (envelope) => {
    if (envelope.type === "ERROR") {
      sendResponse({ error: envelope.error });
    } else {
      sendResponse({ payload: envelope.payload });
    }
  });

  sendToAdapter({
    ...message,
    id,
    meta,
    source: "extension",
    target: "mcp"
  });

  return true;
});

connectNative();
