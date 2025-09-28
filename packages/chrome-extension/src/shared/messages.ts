export interface Snapshot {
  id: string;
  url: string;
  title: string;
  capturedAt: string;
  html: string;
  viewport: Viewport;
  screenshot?: Screenshot;
  metadata?: Record<string, unknown>;
}

export interface Screenshot {
  format: "png" | "jpeg";
  dataUrl: string;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  devicePixelRatio: number;
}

export interface ElementSelector {
  css?: string;
  text?: string;
  exactText?: boolean;
  role?: string;
  attributes?: Record<string, string>;
  index?: number;
}

export interface WaitCondition {
  selector?: ElementSelector;
  strategy?: "exists" | "visible";
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export type PageAction =
  | {
      type: "click";
      selector: ElementSelector;
      button?: "left" | "middle" | "right";
      clickCount?: number;
      delayMs?: number;
    }
  | {
      type: "input";
      selector: ElementSelector;
      value: string;
      replace?: boolean;
      focus?: boolean;
    }
  | {
      type: "scroll";
      selector?: ElementSelector;
      x?: number;
      y?: number;
      behavior?: ScrollBehavior;
    }
  | {
      type: "waitFor";
      condition: WaitCondition;
    }
  | {
      type: "focus";
      selector: ElementSelector;
    }
  | {
      type: "clear";
      selector: ElementSelector;
    };

export interface ActionResult {
  index: number;
  action: PageAction;
  status: "success" | "error";
  message?: string;
}

export interface DomExtractionOptions {
  selector?: ElementSelector;
  includeHtml?: boolean;
  includeText?: boolean;
  includeAttributes?: boolean;
  includeComputedStyles?: boolean;
  maxElements?: number;
}

export interface DomExtractionResult {
  elements: ElementSnapshot[];
}

export interface ElementSnapshot {
  selector: ElementSelector;
  html?: string;
  text?: string;
  attributes?: Record<string, string>;
  computedStyles?: Record<string, string>;
  bounds: DOMRectLike;
}

export interface DOMRectLike {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ScreenshotDiffResult {
  totalPixels: number;
  differingPixels: number;
  mismatchRatio: number;
  diffImage?: Screenshot;
}

export type AgentCommand =
  | {
      kind: "agent:capture";
      requestId: string;
      tabId?: number;
      includeScreenshot?: boolean;
      storeSnapshot?: boolean;
    }
  | {
      kind: "agent:diff";
      requestId: string;
      baselineId: string;
      candidateHtml?: string;
      candidateSnapshotId?: string;
      candidateScreenshot?: Screenshot;
    }
  | {
      kind: "agent:navigate";
      requestId: string;
      url: string;
      tabId?: number;
      newTab?: boolean;
      waitFor?: WaitCondition;
      timeoutMs?: number;
    }
  | {
      kind: "agent:actions";
      requestId: string;
      tabId?: number;
      actions: PageAction[];
      options?: {
        captureSnapshot?: boolean;
        captureScreenshot?: boolean;
        storeSnapshot?: boolean;
      };
    }
  | {
      kind: "agent:screenshot";
      requestId: string;
      tabId?: number;
      options?: ScreenshotOptions;
    }
  | {
      kind: "agent:dom";
      requestId: string;
      tabId?: number;
      extraction: DomExtractionOptions;
    };

export interface ScreenshotOptions {
  format?: "png" | "jpeg";
  quality?: number;
}

export type AgentResponse =
  | {
      kind: "agent:capture:result";
      requestId: string;
      snapshot: Snapshot;
    }
  | {
      kind: "agent:diff:result";
      requestId: string;
      baselineId: string;
      htmlDiff: DiffBlock[];
      screenshotDiff?: ScreenshotDiffResult;
    }
  | {
      kind: "agent:navigate:result";
      requestId: string;
      tabId: number;
      url: string;
      title?: string;
    }
  | {
      kind: "agent:actions:result";
      requestId: string;
      results: ActionResult[];
      snapshot?: Snapshot;
      screenshot?: Screenshot;
    }
  | {
      kind: "agent:screenshot:result";
      requestId: string;
      screenshot: Screenshot;
    }
  | {
      kind: "agent:dom:result";
      requestId: string;
      extraction: DomExtractionResult;
    }
  | {
      kind: "agent:error";
      requestId: string;
      message: string;
      code?: string;
      recoverable?: boolean;
    };

export interface DiffBlock {
  type: "added" | "removed" | "unchanged";
  value: string;
}

export type ContentRequest =
  | {
      kind: "content:capture";
      requestId: string;
    }
  | {
      kind: "content:actions";
      requestId: string;
      actions: PageAction[];
      options?: ContentActionOptions;
    }
  | {
      kind: "content:wait";
      requestId: string;
      condition: WaitCondition;
    }
  | {
      kind: "content:extract";
      requestId: string;
      extraction: DomExtractionOptions;
    };

export interface ContentActionOptions {
  captureSnapshot?: boolean;
}

export type ContentResponse =
  | {
      kind: "content:capture:result";
      requestId: string;
      snapshot: Snapshot;
    }
  | {
      kind: "content:actions:result";
      requestId: string;
      results: ActionResult[];
      snapshot?: Snapshot;
    }
  | {
      kind: "content:wait:result";
      requestId: string;
      satisfied: boolean;
      elapsedMs: number;
    }
  | {
      kind: "content:extract:result";
      requestId: string;
      extraction: DomExtractionResult;
    }
  | {
      kind: "content:error";
      requestId: string;
      message: string;
      actionIndex?: number;
    };

export type BackgroundMessage = AgentCommand | ContentResponse;
export type ContentMessage = ContentRequest | AgentCommand;
