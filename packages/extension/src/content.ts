import { RequestEnvelope, isEnvelope } from "./shared/envelope";

type DomQueryPayload = { selector: string };

declare const chrome: typeof globalThis.chrome;

function handleDomQuery(payload: DomQueryPayload) {
  const selector = payload.selector ?? "";
  const nodes = Array.from(document.querySelectorAll(selector));
  return {
    selector,
    count: nodes.length,
    matches: nodes.slice(0, 20).map((node) => ({
      text: node.textContent ?? "",
      html: node instanceof HTMLElement ? node.outerHTML : node.textContent ?? "",
      tag: node instanceof HTMLElement ? node.tagName.toLowerCase() : node.nodeName
    }))
  };
}

function handleDomDiff() {
  return {
    html: document.documentElement.outerHTML,
    title: document.title,
    location: window.location.href
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isEnvelope(message) || message.type !== "REQUEST") {
    return false;
  }

  const envelope = message as RequestEnvelope;

  try {
    switch (envelope.cap) {
      case "dom.query": {
        const result = handleDomQuery(envelope.payload as DomQueryPayload);
        sendResponse(result);
        break;
      }
      case "dom.diff": {
        const result = handleDomDiff();
        sendResponse(result);
        break;
      }
      default:
        sendResponse({
          error: {
            code: "cap_not_found",
            message: `Capability ${envelope.cap} not implemented in content script`
          }
        });
        break;
    }
  } catch (error) {
    sendResponse({
      error: {
        code: "internal",
        message: error instanceof Error ? error.message : String(error)
      }
    });
  }

  return true;
});
