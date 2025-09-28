import {
  ActionResult,
  ContentActionOptions,
  ContentRequest,
  ContentResponse,
  DomExtractionOptions,
  DomExtractionResult,
  DOMRectLike,
  ElementSelector,
  ElementSnapshot,
  PageAction,
  Snapshot,
  WaitCondition
} from "./shared/messages.js";

declare global {
  interface Window {
    omniEye?: {
      captureSnapshot: () => Snapshot;
      getLastSnapshot: () => Snapshot | null;
      performActions: (actions: PageAction[], options?: ContentActionOptions) => Promise<ActionResult[]>;
      waitFor: (condition: WaitCondition) => Promise<boolean>;
    };
  }
}

let lastSnapshot: Snapshot | null = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isContentRequest(message)) {
    return;
  }

  void handleContentRequest(message)
    .then((response) => sendResponse(response))
    .catch((error) => {
      sendResponse({
        kind: "content:error",
        requestId: message.requestId,
        message: error instanceof Error ? error.message : String(error)
      });
    });

  return true;
});

async function handleContentRequest(message: ContentRequest): Promise<ContentResponse> {
  switch (message.kind) {
    case "content:capture":
      return handleCapture(message.requestId);
    case "content:actions":
      return handleActions(message.requestId, message.actions, message.options);
    case "content:wait":
      return handleWait(message.requestId, message.condition);
    case "content:extract":
      return handleExtract(message.requestId, message.extraction);
    default:
      throw new Error(`Unsupported content request ${(message as { kind: string }).kind}`);
  }
}

function handleCapture(requestId: string): ContentResponse {
  const snapshot = buildSnapshot();
  lastSnapshot = snapshot;

  return {
    kind: "content:capture:result",
    requestId,
    snapshot
  };
}

async function handleActions(requestId: string, actions: PageAction[], options?: ContentActionOptions): Promise<ContentResponse> {
  const results: ActionResult[] = [];
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];

    try {
      await performAction(action);
      results.push({ index, action, status: "success" });
    } catch (error) {
      results.push({
        index,
        action,
        status: "error",
        message: error instanceof Error ? error.message : String(error)
      });
      break;
    }
  }

  const allSucceeded = results.every((result) => result.status === "success");
  const shouldCaptureSnapshot = Boolean(options?.captureSnapshot) && allSucceeded;
  const snapshot = shouldCaptureSnapshot ? buildSnapshot() : undefined;

  if (snapshot) {
    lastSnapshot = snapshot;
  }

  return {
    kind: "content:actions:result",
    requestId,
    results,
    snapshot
  };
}

async function handleWait(requestId: string, condition: WaitCondition): Promise<ContentResponse> {
  const start = performance.now();
  const satisfied = await waitForCondition(condition);
  const elapsedMs = performance.now() - start;

  return {
    kind: "content:wait:result",
    requestId,
    satisfied,
    elapsedMs
  };
}

function handleExtract(requestId: string, extraction: DomExtractionOptions): ContentResponse {
  const result = extractDom(extraction);
  return {
    kind: "content:extract:result",
    requestId,
    extraction: result
  };
}

async function performAction(action: PageAction): Promise<void> {
  switch (action.type) {
    case "click":
      await performClickAction(action);
      break;
    case "input":
      await performInputAction(action);
      break;
    case "scroll":
      await performScrollAction(action);
      break;
    case "waitFor":
      await waitForCondition(action.condition);
      break;
    case "focus":
      focusElement(action.selector);
      break;
    case "clear":
      clearElementValue(action.selector);
      break;
    default:
      throw new Error(`Unsupported action ${(action as { type: string }).type}`);
  }
}

async function performClickAction(action: Extract<PageAction, { type: "click" }>): Promise<void> {
  const element = resolveElement(action.selector);
  scrollElementIntoView(element);

  const clickCount = Math.max(1, action.clickCount ?? 1);
  for (let i = 0; i < clickCount; i += 1) {
    element.click();
    if (action.delayMs) {
      await delay(action.delayMs);
    }
  }
}

async function performInputAction(action: Extract<PageAction, { type: "input" }>): Promise<void> {
  const element = resolveElement(action.selector);

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (action.focus ?? true) {
      element.focus();
    }

    if (action.replace ?? true) {
      element.value = action.value;
    } else {
      element.value += action.value;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  if (element.isContentEditable) {
    if (action.focus ?? true) {
      element.focus();
    }

    if (action.replace ?? true) {
      element.textContent = action.value;
    } else {
      element.textContent = (element.textContent ?? "") + action.value;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  throw new Error("Element does not support text input");
}

async function performScrollAction(action: Extract<PageAction, { type: "scroll" }>): Promise<void> {
  if (action.selector) {
    const element = resolveElement(action.selector);
    element.scrollIntoView({ behavior: action.behavior ?? "smooth", block: "center", inline: "center" });
    return;
  }

  const x = action.x ?? 0;
  const y = action.y ?? 0;

  window.scrollBy({ left: x, top: y, behavior: action.behavior ?? "smooth" });
}

function focusElement(selector: ElementSelector): void {
  const element = resolveElement(selector);
  element.focus();
}

function clearElementValue(selector: ElementSelector): void {
  const element = resolveElement(selector);

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.value = "";
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  if (element.isContentEditable) {
    element.textContent = "";
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  throw new Error("Element does not support clearing its value");
}

async function waitForCondition(condition: WaitCondition): Promise<boolean> {
  const timeoutMs = condition.timeoutMs ?? 10_000;
  const pollIntervalMs = condition.pollIntervalMs ?? 200;
  const strategy = condition.strategy ?? "exists";
  const start = performance.now();

  while (performance.now() - start < timeoutMs) {
    if (!condition.selector) {
      return true;
    }

    const element = findElement(condition.selector);

    if (element && strategy === "exists") {
      return true;
    }

    if (element && strategy === "visible" && isElementVisible(element)) {
      return true;
    }

    await delay(pollIntervalMs);
  }

  return false;
}

function extractDom(options: DomExtractionOptions): DomExtractionResult {
  const elements = options.selector ? resolveElements(options.selector, options.maxElements) : [document.documentElement];
  const result: ElementSnapshot[] = [];
  const limit = options.maxElements ?? elements.length;

  for (let index = 0; index < Math.min(elements.length, limit); index += 1) {
    const element = elements[index];
    const bounds = element.getBoundingClientRect();
    const snapshot: ElementSnapshot = {
      selector: options.selector ?? describeElement(element),
      bounds: rectToLike(bounds)
    };

    if (options.includeHtml ?? true) {
      snapshot.html = element.outerHTML;
    }

    if (options.includeText) {
      const text = element.textContent?.trim();
      if (text) {
        snapshot.text = text;
      }
    }

    if (options.includeAttributes) {
      snapshot.attributes = collectAttributes(element);
    }

    if (options.includeComputedStyles) {
      snapshot.computedStyles = collectComputedStyles(element);
    }

    result.push(snapshot);
  }

  return { elements: result };
}

function resolveElement(selector: ElementSelector): HTMLElement {
  const element = findElement(selector);
  if (!element) {
    throw new Error(`Element not found for selector ${describeSelector(selector)}`);
  }

  return element;
}

function resolveElements(selector: ElementSelector, maxElements?: number): HTMLElement[] {
  const candidates = findElements(selector);
  if (candidates.length === 0) {
    return [];
  }

  if (typeof selector.index === "number") {
    const element = candidates[selector.index];
    return element ? [element] : [];
  }

  if (typeof maxElements === "number") {
    return candidates.slice(0, maxElements);
  }

  return candidates;
}

function findElement(selector: ElementSelector): HTMLElement | null {
  const elements = findElements(selector);

  if (typeof selector.index === "number") {
    return elements[selector.index] ?? null;
  }

  return elements[0] ?? null;
}

function findElements(selector: ElementSelector): HTMLElement[] {
  let baseCandidates: Element[];

  if (selector.css) {
    baseCandidates = Array.from(document.querySelectorAll(selector.css));
  } else {
    const allElements = Array.from(document.querySelectorAll("*"));
    baseCandidates = [document.documentElement, ...allElements].filter((element): element is Element => element instanceof Element);
  }

  let filtered = baseCandidates.filter((candidate): candidate is HTMLElement => candidate instanceof HTMLElement);

  if (selector.role) {
    const role = selector.role.toLowerCase();
    filtered = filtered.filter((element) => (element.getAttribute("role") ?? "").toLowerCase() === role);
  }

  if (selector.attributes) {
    filtered = filtered.filter((element) =>
      Object.entries(selector.attributes as Record<string, string>).every(([attribute, value]) =>
        element.getAttribute(attribute) === value
      )
    );
  }

  if (selector.text) {
    const expected = selector.exactText ? selector.text : selector.text.toLowerCase();
    filtered = filtered.filter((element) => {
      const text = element.textContent?.trim() ?? "";
      if (selector.exactText) {
        return text === expected;
      }
      return text.toLowerCase().includes(expected);
    });
  }

  return filtered;
}

function isContentRequest(message: unknown): message is ContentRequest {
  if (!message || typeof message !== "object" || !("kind" in message)) {
    return false;
  }

  const kind = (message as { kind: unknown }).kind;
  return typeof kind === "string" && kind.startsWith("content:");
}

function buildSnapshot(): Snapshot {
  const html = document.documentElement.outerHTML;
  const id = createSnapshotId();

  return {
    id,
    url: window.location.href,
    title: document.title,
    capturedAt: new Date().toISOString(),
    html,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      devicePixelRatio: window.devicePixelRatio
    }
  };
}

function scrollElementIntoView(element: HTMLElement): void {
  const behavior: ScrollBehavior = "smooth";
  element.scrollIntoView({ behavior, block: "center", inline: "center" });
}

function collectAttributes(element: HTMLElement): Record<string, string> {
  const attributes = element.getAttributeNames();
  return Object.fromEntries(attributes.map((name) => [name, element.getAttribute(name) ?? ""]));
}

function collectComputedStyles(element: HTMLElement): Record<string, string> {
  const computed = window.getComputedStyle(element);
  const properties = [
    "display",
    "position",
    "top",
    "left",
    "right",
    "bottom",
    "width",
    "height",
    "margin",
    "padding",
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "color",
    "background-color",
    "border",
    "opacity"
  ];

  return Object.fromEntries(properties.map((property) => [property, computed.getPropertyValue(property)]));
}

function describeElement(element: Element): ElementSelector {
  if (!(element instanceof Element)) {
    return { css: "" };
  }

  if (element.id) {
    return { css: `#${cssEscape(element.id)}` };
  }

  const path: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.tagName.toLowerCase();

    if (current.classList.length > 0) {
      selector += `.${Array.from(current.classList)
        .slice(0, 3)
        .map((token) => cssEscape(token))
        .join(".")}`;
    }

    const siblingIndex = getSiblingIndex(current);
    if (siblingIndex > 0) {
      selector += `:nth-of-type(${siblingIndex + 1})`;
    }

    path.unshift(selector);

    if (current.id) {
      break;
    }

    current = current.parentElement;
  }

  return { css: path.join(" > ") };
}

function describeSelector(selector: ElementSelector): string {
  const parts: string[] = [];
  if (selector.css) {
    parts.push(`css="${selector.css}"`);
  }
  if (selector.text) {
    parts.push(`text="${selector.text}"`);
  }
  if (selector.role) {
    parts.push(`role="${selector.role}"`);
  }
  if (selector.index !== undefined) {
    parts.push(`index=${selector.index}`);
  }
  return parts.join(" ");
}

function rectToLike(rect: DOMRect): DOMRectLike {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left
  };
}

function isElementVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    rect.bottom >= 0 &&
    rect.top <= window.innerHeight
  );
}

function getSiblingIndex(element: Element): number {
  const siblings = element.parentElement?.children;
  if (!siblings) {
    return 0;
  }

  let index = 0;
  for (let i = 0; i < siblings.length; i += 1) {
    if (siblings[i].tagName === element.tagName) {
      if (siblings[i] === element) {
        return index;
      }
      index += 1;
    }
  }

  return index;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/[^a-zA-Z0-9_-]/g, (match) => `\\${match.charCodeAt(0).toString(16)} `);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function createSnapshotId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `snapshot-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

window.omniEye = {
  captureSnapshot: () => {
    const snapshot = buildSnapshot();
    lastSnapshot = snapshot;
    return snapshot;
  },
  getLastSnapshot: () => lastSnapshot,
  performActions: async (actions: PageAction[], options?: ContentActionOptions) => {
    const response = await handleActions(createSnapshotId(), actions, options);
    return response.kind === "content:actions:result" ? response.results : [];
  },
  waitFor: async (condition: WaitCondition) => waitForCondition(condition)
};
