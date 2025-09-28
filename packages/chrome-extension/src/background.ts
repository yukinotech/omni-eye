import {
  AgentCommand,
  AgentResponse,
  ContentRequest,
  ContentResponse,
  DiffBlock,
  Screenshot,
  ScreenshotDiffResult,
  ScreenshotOptions,
  Snapshot
} from "./shared/messages.js";

const snapshots = new Map<string, Snapshot>();
const BRIDGE_URL = "ws://localhost:7337";
let bridge: WebSocket | null = null;

chrome.runtime.onInstalled.addListener(() => {
  console.info("[omni-eye] background installed");
  void ensureBridge();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureBridge();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isKnownMessage(message)) {
    return;
  }

  void handleMessage(message, sender).then(
    (response) => sendResponse(response),
    (error) => sendResponse(createErrorResponse("unknown", error))
  );

  return true;
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!isAgentCommand(message)) {
    return;
  }

  void handleAgentCommand(message).then(
    (response) => sendResponse(response),
    (error) => sendResponse(createErrorResponse(message.requestId, error))
  );

  return true;
});

async function handleMessage(message: AgentCommand | ContentResponse, sender: chrome.runtime.MessageSender) {
  if (isAgentCommand(message)) {
    return handleAgentCommand(message, sender);
  }

  return { ok: false };
}

async function handleAgentCommand(command: AgentCommand, sender?: chrome.runtime.MessageSender): Promise<AgentResponse> {
  await ensureBridge();

  try {
    switch (command.kind) {
      case "agent:capture":
        return handleCaptureCommand(command, sender);
      case "agent:diff":
        return await handleDiffCommand(command);
      case "agent:navigate":
        return await handleNavigateCommand(command, sender);
      case "agent:actions":
        return await handleActionsCommand(command, sender);
      case "agent:screenshot":
        return await handleScreenshotCommand(command, sender);
      case "agent:dom":
        return await handleDomCommand(command, sender);
    default: {
      const fallback = command as AgentCommand;
      return createErrorResponse(fallback.requestId, `Unsupported command ${fallback.kind}`);
    }
    }
  } catch (error) {
    console.error("[omni-eye] command failed", command.kind, error);
    return createErrorResponse(command.requestId, error);
  }
}

async function handleCaptureCommand(command: Extract<AgentCommand, { kind: "agent:capture" }>, sender?: chrome.runtime.MessageSender): Promise<AgentResponse> {
  const tabId = await resolveTabId(command.tabId ?? sender?.tab?.id);
  const snapshot = await captureTabSnapshot(tabId, {
    includeScreenshot: command.includeScreenshot ?? true,
    store: command.storeSnapshot ?? true,
    requestId: command.requestId
  });

  return {
    kind: "agent:capture:result",
    requestId: command.requestId,
    snapshot
  };
}

async function handleDiffCommand(command: Extract<AgentCommand, { kind: "agent:diff" }>): Promise<AgentResponse> {
  const baseline = snapshots.get(command.baselineId);

  if (!baseline) {
    return createErrorResponse(command.requestId, `Unknown baseline snapshot ${command.baselineId}`, "baseline_not_found");
  }

  let candidateHtml = command.candidateHtml;
  let candidateScreenshot = command.candidateScreenshot;

  if (command.candidateSnapshotId) {
    const candidateSnapshot = snapshots.get(command.candidateSnapshotId);
    if (!candidateSnapshot) {
      return createErrorResponse(command.requestId, `Unknown candidate snapshot ${command.candidateSnapshotId}`, "candidate_not_found");
    }

    if (!candidateHtml) {
      candidateHtml = candidateSnapshot.html;
    }

    if (!candidateScreenshot) {
      candidateScreenshot = candidateSnapshot.screenshot;
    }
  }

  if (!candidateHtml) {
    return createErrorResponse(command.requestId, "candidateHtml or candidateSnapshotId is required", "missing_candidate_html");
  }

  const htmlDiff = diffHtml(baseline.html, candidateHtml);
  let screenshotDiff: ScreenshotDiffResult | undefined;

  if (baseline.screenshot && candidateScreenshot) {
    screenshotDiff = await diffScreenshots(baseline.screenshot, candidateScreenshot);
  }

  return {
    kind: "agent:diff:result",
    requestId: command.requestId,
    baselineId: command.baselineId,
    htmlDiff,
    screenshotDiff
  };
}

async function handleNavigateCommand(command: Extract<AgentCommand, { kind: "agent:navigate" }>, sender?: chrome.runtime.MessageSender): Promise<AgentResponse> {
  const preferredTabId = command.tabId ?? sender?.tab?.id;
  const tabId = await openOrUpdateTab(command.url, {
    newTab: command.newTab,
    preferredTabId
  });

  await waitForTabComplete(tabId, command.timeoutMs ?? 20_000);

  if (command.waitFor) {
    const waitResponse = await sendContentRequest(tabId, {
      kind: "content:wait",
      requestId: `${command.requestId}::wait`,
      condition: command.waitFor
    });

    if (waitResponse.kind === "content:wait:result" && !waitResponse.satisfied) {
      return createErrorResponse(command.requestId, "Wait condition not satisfied before timeout", "wait_timeout");
    }

    if (waitResponse.kind === "content:error") {
      return createErrorResponse(command.requestId, waitResponse.message, "wait_failed");
    }
  }

  const tab = await chrome.tabs.get(tabId);

  return {
    kind: "agent:navigate:result",
    requestId: command.requestId,
    tabId,
    url: tab.url ?? command.url,
    title: tab.title ?? undefined
  };
}

async function handleActionsCommand(command: Extract<AgentCommand, { kind: "agent:actions" }>, sender?: chrome.runtime.MessageSender): Promise<AgentResponse> {
  const tabId = await resolveTabId(command.tabId ?? sender?.tab?.id);
  const response = await sendContentRequest(tabId, {
    kind: "content:actions",
    requestId: command.requestId,
    actions: command.actions,
    options: {
      captureSnapshot: command.options?.captureSnapshot ?? false
    }
  });

  if (response.kind === "content:error") {
    return createErrorResponse(command.requestId, response.message, "actions_failed");
  }

  if (response.kind !== "content:actions:result") {
    return createErrorResponse(command.requestId, "Unexpected content action response", "unexpected_response");
  }

  let snapshot = response.snapshot;

  if (!snapshot && (command.options?.captureSnapshot || command.options?.captureScreenshot || command.options?.storeSnapshot)) {
    snapshot = await captureTabSnapshot(tabId, {
      includeScreenshot: command.options?.captureScreenshot ?? false,
      store: false,
      requestId: `${command.requestId}::post-actions`
    });
  }

  if (snapshot && command.options?.captureScreenshot && !snapshot.screenshot) {
    const screenshot = await captureScreenshotForTab(tabId, undefined, snapshot.viewport);
    snapshot = { ...snapshot, screenshot };
  }

  if (snapshot && (command.options?.storeSnapshot ?? false)) {
    storeSnapshot(snapshot);
  }

  return {
    kind: "agent:actions:result",
    requestId: command.requestId,
    results: response.results,
    snapshot,
    screenshot: snapshot?.screenshot
  };
}

async function handleScreenshotCommand(command: Extract<AgentCommand, { kind: "agent:screenshot" }>, sender?: chrome.runtime.MessageSender): Promise<AgentResponse> {
  const tabId = await resolveTabId(command.tabId ?? sender?.tab?.id);
  const screenshot = await captureScreenshotForTab(tabId, command.options);

  return {
    kind: "agent:screenshot:result",
    requestId: command.requestId,
    screenshot
  };
}

async function handleDomCommand(command: Extract<AgentCommand, { kind: "agent:dom" }>, sender?: chrome.runtime.MessageSender): Promise<AgentResponse> {
  const tabId = await resolveTabId(command.tabId ?? sender?.tab?.id);
  const response = await sendContentRequest(tabId, {
    kind: "content:extract",
    requestId: command.requestId,
    extraction: command.extraction
  });

  if (response.kind === "content:error") {
    return createErrorResponse(command.requestId, response.message, "extract_failed");
  }

  if (response.kind !== "content:extract:result") {
    return createErrorResponse(command.requestId, "Unexpected DOM extraction response", "unexpected_response");
  }

  return {
    kind: "agent:dom:result",
    requestId: command.requestId,
    extraction: response.extraction
  };
}

async function captureTabSnapshot(
  tabId: number,
  options: { includeScreenshot?: boolean; store?: boolean; requestId?: string } = {}
): Promise<Snapshot> {
  const requestId = options.requestId ?? createInternalRequestId("capture");
  const response = await sendContentRequest(tabId, {
    kind: "content:capture",
    requestId
  });

  if (response.kind === "content:error") {
    throw new Error(response.message);
  }

  if (response.kind !== "content:capture:result") {
    throw new Error("Unexpected capture response from content script");
  }

  let snapshot = response.snapshot;

  if (options.includeScreenshot ?? true) {
    const screenshot = await captureScreenshotForTab(tabId, undefined, snapshot.viewport);
    snapshot = { ...snapshot, screenshot };
  }

  if (options.store ?? true) {
    storeSnapshot(snapshot);
  }

  return snapshot;
}

function storeSnapshot(snapshot: Snapshot): void {
  snapshots.set(snapshot.id, snapshot);
  notifyBridge({
    type: "snapshot",
    payload: snapshot
  });
}

async function openOrUpdateTab(url: string, options: { newTab?: boolean; preferredTabId?: number | undefined }): Promise<number> {
  if (options.newTab) {
    const createdTab = await chrome.tabs.create({ url, active: true });
    if (createdTab.id === undefined) {
      throw new Error("Failed to create tab for navigation");
    }

    return createdTab.id;
  }

  const tabId = await resolveTabId(options.preferredTabId);
  await chrome.tabs.update(tabId, { url, active: true });
  return tabId;
}

async function resolveTabId(preferredTabId?: number): Promise<number> {
  if (typeof preferredTabId === "number") {
    return preferredTabId;
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!activeTab?.id) {
    throw new Error("No active tab available");
  }

  return activeTab.id;
}

async function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  const existing = await chrome.tabs.get(tabId);
  if (existing.status === "complete") {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        cleanup();
        resolve();
      }
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for tab to finish loading"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function captureScreenshotForTab(tabId: number, options?: ScreenshotOptions, viewport?: Snapshot["viewport"]): Promise<Screenshot> {
  const tab = await chrome.tabs.get(tabId);
  const windowId = tab.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
  const format = options?.format ?? "png";
  const imageDetails: chrome.tabs.CaptureVisibleTabOptions = { format };

  if (format === "jpeg" && typeof options?.quality === "number") {
    imageDetails.quality = options.quality;
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, imageDetails, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!result) {
        reject(new Error("Failed to capture screenshot"));
        return;
      }

      resolve(result);
    });
  });

  const blob = await blobFromDataUrl(dataUrl);
  const bitmap = await createImageBitmap(blob);
  const width = viewport ? Math.round(viewport.width * viewport.devicePixelRatio) : bitmap.width;
  const height = viewport ? Math.round(viewport.height * viewport.devicePixelRatio) : bitmap.height;
  bitmap.close();

  return {
    format,
    dataUrl,
    width,
    height
  };
}

async function diffScreenshots(baseline: Screenshot, candidate: Screenshot): Promise<ScreenshotDiffResult> {
  const [baselineBitmap, candidateBitmap] = await Promise.all([
    createImageBitmap(await blobFromDataUrl(baseline.dataUrl)),
    createImageBitmap(await blobFromDataUrl(candidate.dataUrl))
  ]);

  const width = Math.max(baselineBitmap.width, candidateBitmap.width);
  const height = Math.max(baselineBitmap.height, candidateBitmap.height);

  const totalPixels = width * height;
  if (totalPixels === 0) {
    baselineBitmap.close();
    candidateBitmap.close();
    return {
      totalPixels,
      differingPixels: 0,
      mismatchRatio: 0
    };
  }

  const baselineCtx = get2dContext(new OffscreenCanvas(width, height));
  baselineCtx.clearRect(0, 0, width, height);
  baselineCtx.drawImage(baselineBitmap, 0, 0);
  const baselineData = baselineCtx.getImageData(0, 0, width, height);

  const candidateCtx = get2dContext(new OffscreenCanvas(width, height));
  candidateCtx.clearRect(0, 0, width, height);
  candidateCtx.drawImage(candidateBitmap, 0, 0);
  const candidateData = candidateCtx.getImageData(0, 0, width, height);

  baselineBitmap.close();
  candidateBitmap.close();

  const diffCanvas = new OffscreenCanvas(width, height);
  const diffCtx = get2dContext(diffCanvas);
  const diffImage = diffCtx.createImageData(width, height);

  const threshold = 32;
  let differingPixels = 0;

  for (let i = 0; i < baselineData.data.length; i += 4) {
    const dr = Math.abs(baselineData.data[i] - candidateData.data[i]);
    const dg = Math.abs(baselineData.data[i + 1] - candidateData.data[i + 1]);
    const db = Math.abs(baselineData.data[i + 2] - candidateData.data[i + 2]);
    const da = Math.abs(baselineData.data[i + 3] - candidateData.data[i + 3]);

    const isDifferent = dr > threshold || dg > threshold || db > threshold || da > threshold;

    if (isDifferent) {
      differingPixels += 1;
      diffImage.data[i] = 255;
      diffImage.data[i + 1] = 0;
      diffImage.data[i + 2] = 0;
      diffImage.data[i + 3] = 200;
    } else {
      diffImage.data[i] = baselineData.data[i];
      diffImage.data[i + 1] = baselineData.data[i + 1];
      diffImage.data[i + 2] = baselineData.data[i + 2];
      diffImage.data[i + 3] = baselineData.data[i + 3];
    }
  }

  diffCtx.putImageData(diffImage, 0, 0);
  const diffBlob = await diffCanvas.convertToBlob({ type: "image/png" });
  const diffDataUrl = await blobToDataUrl(diffBlob);

  return {
    totalPixels,
    differingPixels,
    mismatchRatio: differingPixels / totalPixels,
    diffImage: {
      format: "png",
      dataUrl: diffDataUrl,
      width,
      height
    }
  };
}

function diffHtml(baseline: string, candidate: string): DiffBlock[] {
  if (baseline === candidate) {
    return [
      {
        type: "unchanged",
        value: "No differences detected"
      }
    ];
  }

  return [
    {
      type: "removed",
      value: baseline.substring(0, Math.min(baseline.length, 5000))
    },
    {
      type: "added",
      value: candidate.substring(0, Math.min(candidate.length, 5000))
    }
  ];
}

async function sendContentRequest(tabId: number, payload: ContentRequest): Promise<ContentResponse> {
  await ensureContentScript(tabId);

  return new Promise<ContentResponse>((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, payload, (response: ContentResponse | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response || !isContentResponse(response)) {
        reject(new Error("Unexpected response from content script"));
        return;
      }

      resolve(response);
    });
  });
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  } catch (error) {
    if (!isKnownInjectionError(error)) {
      throw error;
    }
  }
}

function isKnownInjectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("Cannot access a chrome:// URL") || error.message.includes("Cannot access contents");
}

async function ensureBridge(): Promise<void> {
  if (bridge && (bridge.readyState === WebSocket.OPEN || bridge.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const socket = new WebSocket(BRIDGE_URL);

  socket.addEventListener("open", () => {
    console.info("[omni-eye] connected to bridge", BRIDGE_URL);
    socket.send(
      JSON.stringify({
        type: "hello",
        payload: { source: "extension", version: chrome.runtime.getManifest().version }
      })
    );
  });

  socket.addEventListener("close", () => {
    console.warn("[omni-eye] bridge closed, retrying");
    bridge = null;
    setTimeout(() => {
      void ensureBridge();
    }, 2000);
  });

  socket.addEventListener("error", (event) => {
    console.error("[omni-eye] bridge error", event);
  });

  socket.addEventListener("message", (event) => {
    try {
      const command: AgentCommand = JSON.parse(event.data as string);
      void handleAgentCommand(command).then((response) => notifyBridge(response));
    } catch (error) {
      console.error("[omni-eye] failed to parse bridge message", error);
    }
  });

  bridge = socket;
}

function notifyBridge(message: unknown): void {
  if (!bridge || bridge.readyState !== WebSocket.OPEN) {
    return;
  }

  bridge.send(JSON.stringify(message));
}

function isAgentCommand(message: unknown): message is AgentCommand {
  return Boolean(
    message &&
      typeof message === "object" &&
      "kind" in message &&
      typeof (message as { kind: unknown }).kind === "string" &&
      (message as { kind: string }).kind.startsWith("agent:")
  );
}

function isContentResponse(message: unknown): message is ContentResponse {
  if (!message || typeof message !== "object" || !("kind" in message)) {
    return false;
  }

  const kind = (message as { kind: unknown }).kind;
  return typeof kind === "string" && kind.startsWith("content:");
}

function isKnownMessage(message: unknown): message is AgentCommand | ContentResponse {
  return isAgentCommand(message) || isContentResponse(message);
}

function createErrorResponse(requestId: string, error: unknown, code?: string): AgentResponse {
  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: "agent:error",
    requestId,
    message,
    code
  };
}

function get2dContext(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to acquire 2D canvas context");
  }

  return context;
}

async function blobFromDataUrl(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch data URL: ${response.status}`);
  }

  return await response.blob();
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(bytes.length, i + chunkSize));
    binary += String.fromCharCode(...chunk);
  }

  const base64 = btoa(binary);
  return `data:${blob.type || "application/octet-stream"};base64,${base64}`;
}

function createInternalRequestId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}:${crypto.randomUUID()}`;
  }

  return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}
