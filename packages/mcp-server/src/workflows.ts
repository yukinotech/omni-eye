import type { ActionResult, AgentResponse, Snapshot, WaitCondition } from "./messages.js";
import { OmniEyeClient } from "./client.js";
import { parseActionsFromPrompt } from "./prompt-parser.js";

export interface PageSetup {
  url: string;
  actionsPrompt?: string;
  waitFor?: WaitCondition;
}

export interface UiConsistencyRequest {
  baseline: PageSetup;
  candidate: PageSetup;
  reuseTab?: boolean;
}

export interface UiConsistencyResult {
  baselineSnapshot: Snapshot;
  candidateSnapshot: Snapshot;
  diff: Extract<AgentResponse, { kind: "agent:diff:result" }>;
  baselineActions: ActionResult[];
  candidateActions: ActionResult[];
  diagnostics: string[];
  summary: string;
}

export class OmniEyeWorkflows {
  constructor(private readonly client: OmniEyeClient) {}

  async verifyUiConsistency(request: UiConsistencyRequest): Promise<UiConsistencyResult> {
    const diagnostics: string[] = [];
    const reuseTab = request.reuseTab ?? true;

    const baselineNav = await this.client.navigate({
      url: request.baseline.url,
      newTab: true,
      waitFor: request.baseline.waitFor,
    });

    const baselineActions = parseActionsFromPrompt(request.baseline.actionsPrompt ?? "");
    diagnostics.push(...baselineActions.diagnostics.map((text) => `[baseline] ${text}`));

    let baselineActionResults: ActionResult[] = [];
    if (baselineActions.actions.length > 0) {
      const response = await this.client.performActions({
        tabId: baselineNav.tabId,
        actions: baselineActions.actions,
        options: { captureSnapshot: false, captureScreenshot: false, storeSnapshot: false },
      });
      baselineActionResults = response.results;
    }

    const baselineSnapshot = await this.client.capture({
      tabId: baselineNav.tabId,
      includeScreenshot: true,
      storeSnapshot: true,
    });

    const candidateNav = await this.client.navigate({
      url: request.candidate.url,
      tabId: reuseTab ? baselineNav.tabId : undefined,
      newTab: reuseTab ? false : true,
      waitFor: request.candidate.waitFor,
    });

    const candidateActions = parseActionsFromPrompt(request.candidate.actionsPrompt ?? "");
    diagnostics.push(...candidateActions.diagnostics.map((text) => `[candidate] ${text}`));

    let candidateActionResults: ActionResult[] = [];
    if (candidateActions.actions.length > 0) {
      const response = await this.client.performActions({
        tabId: candidateNav.tabId,
        actions: candidateActions.actions,
        options: { captureSnapshot: false, captureScreenshot: false, storeSnapshot: false },
      });
      candidateActionResults = response.results;
    }

    const candidateSnapshot = await this.client.capture({
      tabId: candidateNav.tabId,
      includeScreenshot: true,
      storeSnapshot: true,
    });

    const diff = await this.client.compareSnapshots({
      baselineId: baselineSnapshot.id,
      candidateSnapshotId: candidateSnapshot.id,
    });

    return {
      baselineSnapshot,
      candidateSnapshot,
      diff,
      baselineActions: baselineActionResults,
      candidateActions: candidateActionResults,
      diagnostics,
      summary: buildSummary(diff),
    };
  }
}

function buildSummary(diff: Extract<AgentResponse, { kind: "agent:diff:result" }>): string {
  const htmlChanges = diff.htmlDiff.filter((block) => block.type !== "unchanged").length;
  if (!diff.screenshotDiff) {
    return `HTML diff blocks: ${htmlChanges}. Screenshot diff unavailable.`;
  }

  const mismatchPercent = (diff.screenshotDiff.mismatchRatio * 100).toFixed(2);
  return `HTML diff blocks: ${htmlChanges}. Screenshot mismatch ${mismatchPercent}% across ${diff.screenshotDiff.totalPixels} pixels.`;
}
