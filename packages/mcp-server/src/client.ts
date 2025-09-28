import { randomUUID } from "node:crypto";
import type {
  AgentCommand,
  AgentResponse,
  DomExtractionOptions,
  DomExtractionResult,
  PageAction,
  Screenshot,
  Snapshot,
  WaitCondition,
} from "./messages.js";
import { ExtensionBridge } from "./bridge.js";

type DiffResponse = Extract<AgentResponse, { kind: "agent:diff:result" }>;
type CaptureResponse = Extract<AgentResponse, { kind: "agent:capture:result" }>;
type ActionsResponse = Extract<AgentResponse, { kind: "agent:actions:result" }>;
type NavigateResponse = Extract<AgentResponse, { kind: "agent:navigate:result" }>;
type ScreenshotResponse = Extract<AgentResponse, { kind: "agent:screenshot:result" }>;
type DomResponse = Extract<AgentResponse, { kind: "agent:dom:result" }>;

export interface NavigateParams {
  url: string;
  tabId?: number;
  newTab?: boolean;
  waitFor?: WaitCondition;
  timeoutMs?: number;
}

export interface CaptureParams {
  tabId?: number;
  includeScreenshot?: boolean;
  storeSnapshot?: boolean;
  requestId?: string;
}

export interface ActionParams {
  actions: PageAction[];
  tabId?: number;
  options?: {
    captureSnapshot?: boolean;
    captureScreenshot?: boolean;
    storeSnapshot?: boolean;
  };
}

export interface CompareParams {
  baselineId: string;
  candidateSnapshotId?: string;
  candidateHtml?: string;
  candidateScreenshot?: Screenshot;
}

export interface ScreenshotParams {
  tabId?: number;
  format?: Screenshot["format"];
  quality?: number;
}

export interface DomExtractionParams {
  extraction: DomExtractionOptions;
  tabId?: number;
}

export class OmniEyeClient {
  constructor(private readonly bridge: ExtensionBridge) {}

  async navigate(params: NavigateParams): Promise<NavigateResponse> {
    const requestId = this.createRequestId("navigate", params.url);
    const command = {
      kind: "agent:navigate" as const,
      requestId,
      url: params.url,
      tabId: params.tabId,
      newTab: params.newTab,
      waitFor: params.waitFor,
      timeoutMs: params.timeoutMs,
    } satisfies AgentCommand;

    const response = await this.bridge.send(command);

    return this.expectKind(response, "agent:navigate:result");
  }

  async capture(params: CaptureParams = {}): Promise<Snapshot> {
    const requestId = params.requestId ?? this.createRequestId("capture");
    const command = {
      kind: "agent:capture" as const,
      requestId,
      tabId: params.tabId,
      includeScreenshot: params.includeScreenshot ?? true,
      storeSnapshot: params.storeSnapshot ?? true,
    } satisfies AgentCommand;

    const response = await this.bridge.send(command);

    const result = this.expectKind(response, "agent:capture:result");
    return result.snapshot;
  }

  async performActions(params: ActionParams): Promise<ActionsResponse> {
    const requestId = this.createRequestId("actions");
    const command = {
      kind: "agent:actions" as const,
      requestId,
      tabId: params.tabId,
      actions: params.actions,
      options: params.options,
    } satisfies AgentCommand;

    const response = await this.bridge.send(command);

    return this.expectKind(response, "agent:actions:result");
  }

  async captureScreenshot(params: ScreenshotParams = {}): Promise<Screenshot> {
    const requestId = this.createRequestId("screenshot");
    const command = {
      kind: "agent:screenshot" as const,
      requestId,
      tabId: params.tabId,
      options: {
        format: params.format,
        quality: params.quality,
      },
    } satisfies AgentCommand;

    const response = await this.bridge.send(command);

    const result = this.expectKind(response, "agent:screenshot:result");
    return result.screenshot;
  }

  async extractDom(params: DomExtractionParams): Promise<DomExtractionResult> {
    const requestId = this.createRequestId("extract");
    const command = {
      kind: "agent:dom" as const,
      requestId,
      tabId: params.tabId,
      extraction: params.extraction,
    } satisfies AgentCommand;

    const response = await this.bridge.send(command);

    const result = this.expectKind(response, "agent:dom:result");
    return result.extraction;
  }

  async compareSnapshots(params: CompareParams): Promise<DiffResponse> {
    const requestId = this.createRequestId("diff");
    const command = {
      kind: "agent:diff" as const,
      requestId,
      baselineId: params.baselineId,
      candidateSnapshotId: params.candidateSnapshotId,
      candidateHtml: params.candidateHtml,
      candidateScreenshot: params.candidateScreenshot,
    } satisfies AgentCommand;

    const response = await this.bridge.send(command);

    return this.expectKind(response, "agent:diff:result");
  }

  private expectKind<Kind extends AgentResponse["kind"]>(
    response: AgentResponse,
    expected: Kind,
  ): Extract<AgentResponse, { kind: Kind }> {
    if (response.kind === "agent:error") {
      throw new Error(response.message);
    }

    if (response.kind !== expected) {
      throw new Error(
        `Unexpected response kind: expected ${expected} but received ${response.kind}`,
      );
    }

    return response as Extract<AgentResponse, { kind: Kind }>;
  }

  private createRequestId(prefix: string, seed?: string): string {
    const suffix = seed ? `${seed}:${randomUUID()}` : randomUUID();
    return `${prefix}:${suffix}`;
  }
}
