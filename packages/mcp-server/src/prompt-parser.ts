import type { ElementSelector, PageAction } from "./messages.js";

export interface PromptParseResult {
  actions: PageAction[];
  diagnostics: string[];
}

export function parseActionsFromPrompt(prompt: string): PromptParseResult {
  const diagnostics: string[] = [];
  const trimmed = prompt.trim();

  if (!trimmed) {
    return { actions: [], diagnostics };
  }

  const jsonResult = tryParseActionsJson(trimmed, diagnostics);
  if (jsonResult) {
    return { actions: jsonResult, diagnostics };
  }

  const heuristicActions = parseActionsHeuristically(trimmed, diagnostics);
  return { actions: heuristicActions, diagnostics };
}

function tryParseActionsJson(text: string, diagnostics: string[]): PageAction[] | null {
  if (!(text.startsWith("{") || text.startsWith("["))) {
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    const candidates = Array.isArray(parsed) ? parsed : parsed?.actions;

    if (!Array.isArray(candidates)) {
      diagnostics.push("Prompt JSON does not contain an actions array");
      return [];
    }

    const actions: PageAction[] = [];
    for (const candidate of candidates) {
      const normalised = normaliseAction(candidate);
      if (normalised) {
        actions.push(normalised);
      } else {
        diagnostics.push(`Unsupported action entry: ${JSON.stringify(candidate)}`);
      }
    }

    return actions;
  } catch (error) {
    diagnostics.push(`Failed to parse prompt as JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export function normaliseAction(candidate: unknown): PageAction | null {
  if (!candidate || typeof candidate !== "object" || !("type" in candidate)) {
    return null;
  }

  const type = String((candidate as { type: unknown }).type);
  const selectorInput = (candidate as { selector?: unknown }).selector;
  const selector = selectorInput ? normaliseSelector(selectorInput) : undefined;

  switch (type) {
    case "click":
      if (!selector) return null;
      return {
        type: "click",
        selector,
        button: (candidate as { button?: "left" | "middle" | "right" }).button ?? "left",
        clickCount: (candidate as { clickCount?: number }).clickCount,
        delayMs: (candidate as { delayMs?: number }).delayMs
      };
    case "input": {
      if (!selector) return null;
      const value = (candidate as { value?: unknown }).value;
      if (typeof value !== "string") {
        return null;
      }
      return {
        type: "input",
        selector,
        value,
        replace: (candidate as { replace?: boolean }).replace,
        focus: (candidate as { focus?: boolean }).focus
      };
    }
    case "scroll": {
      const record = candidate as Record<string, unknown>;
      const xCandidate = record.x;
      const yCandidate = record.y;
      const behaviorCandidate = record.behavior;

      const xValue = typeof xCandidate === "number" ? xCandidate : undefined;
      const yValue = typeof yCandidate === "number" ? yCandidate : undefined;
      const behavior = typeof behaviorCandidate === "string" ? (behaviorCandidate as ScrollBehavior) : undefined;

      const action: Extract<PageAction, { type: "scroll" }> = {
        type: "scroll",
        selector,
        x: xValue,
        y: yValue,
        behavior
      };
      return action;
    }
    case "waitFor": {
      const condition = (candidate as { condition?: unknown }).condition;
      if (!condition || typeof condition !== "object") {
        return null;
      }
      return {
        type: "waitFor",
        condition: {
          selector: normaliseSelector((condition as { selector?: unknown }).selector),
          strategy: (condition as { strategy?: "exists" | "visible" }).strategy,
          timeoutMs: (condition as { timeoutMs?: number }).timeoutMs,
          pollIntervalMs: (condition as { pollIntervalMs?: number }).pollIntervalMs
        }
      };
    }
    case "focus": {
      if (!selector) return null;
      return {
        type: "focus",
        selector
      };
    }
    case "clear": {
      if (!selector) return null;
      return {
        type: "clear",
        selector
      };
    }
    default:
      return null;
  }
}

export function normaliseSelector(selector: unknown): ElementSelector | undefined {
  if (!selector || typeof selector !== "object") {
    if (typeof selector === "string") {
      return parseSelectorFragment(selector);
    }
    return undefined;
  }

  const base = selector as ElementSelector;
  return {
    css: typeof base.css === "string" ? base.css : undefined,
    text: typeof base.text === "string" ? base.text : undefined,
    exactText: typeof base.exactText === "boolean" ? base.exactText : undefined,
    role: typeof base.role === "string" ? base.role : undefined,
    attributes: typeof base.attributes === "object" ? base.attributes ?? undefined : undefined,
    index: typeof base.index === "number" ? base.index : undefined
  };
}

function parseActionsHeuristically(prompt: string, diagnostics: string[]): PageAction[] {
  const actions: PageAction[] = [];
  const lines = prompt
    .split(/\n|[.;]+/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const action = parseLine(line);
    if (action) {
      actions.push(action);
    } else {
      diagnostics.push(`Unable to interpret instruction: "${line}"`);
    }
  }

  return actions;
}

function parseLine(line: string): PageAction | null {
  const lower = line.toLowerCase();

  if (lower.startsWith("click") || lower.startsWith("tap") || lower.startsWith("点击")) {
    const selectorPart = line.replace(/^(click|tap|点击)/i, "").trim();
    const selector = parseSelectorFragment(selectorPart);
    if (!selector) {
      return null;
    }
    return { type: "click", selector };
  }

  if (lower.startsWith("input") || lower.startsWith("type") || lower.startsWith("输入")) {
    const value = extractQuoted(line) ?? extractTrailingValue(line);
    const selectorPart = line.replace(/^(input|type|输入)/i, "").replace(value ?? "", "").replace(/到|在|到达|into|为|\s+value/i, "").trim();
    const selector = parseSelectorFragment(selectorPart);
    if (!selector || !value) {
      return null;
    }
    return { type: "input", selector, value, replace: true };
  }

  if (lower.startsWith("scroll") || lower.startsWith("滚动")) {
    if (/down/i.test(lower) || /向下/.test(line)) {
      return { type: "scroll", y: 400 };
    }

    if (/up/i.test(lower) || /向上/.test(line)) {
      return { type: "scroll", y: -400 };
    }

    const selectorPart = line.replace(/^(scroll|滚动)/i, "").trim();
    if (selectorPart) {
      const selector = parseSelectorFragment(selectorPart);
      if (selector) {
        return { type: "scroll", selector };
      }
    }

    const distance = parseFloat(selectorPart);
    if (!Number.isNaN(distance)) {
      return { type: "scroll", y: distance };
    }

    return { type: "scroll", y: 400 };
  }

  if (lower.startsWith("wait") || lower.startsWith("等待")) {
    const selector = parseSelectorFragment(line.replace(/^(wait|等待)/i, "").trim());
    return {
      type: "waitFor",
      condition: {
        selector,
        strategy: selector ? "visible" : "exists",
        timeoutMs: 10_000,
        pollIntervalMs: 200
      }
    };
  }

  return null;
}

function parseSelectorFragment(fragment: unknown): ElementSelector | undefined {
  if (typeof fragment !== "string") {
    return undefined;
  }

  const trimmed = fragment.trim();
  if (!trimmed) {
    return undefined;
  }

  const cssMatch = trimmed.match(/css[:=]\s*(.+)$/i);
  if (cssMatch) {
    return { css: cssMatch[1].trim() };
  }

  const textMatch = trimmed.match(/text[:=]\s*"?([^"']+)"?/i) ?? trimmed.match(/文本[:=]\s*"?([^"']+)"?/i);
  if (textMatch) {
    return { text: textMatch[1].trim(), exactText: false };
  }

  const roleMatch = trimmed.match(/role[:=]\s*"?([^"']+)"?/i);
  if (roleMatch) {
    return { role: roleMatch[1].trim() };
  }

  const attrMatch = trimmed.match(/\[(?<name>[^=\]]+)=\"?(?<value>[^\"]+)\"?\]/);
  if (attrMatch && attrMatch.groups) {
    return {
      attributes: {
        [attrMatch.groups.name.trim()]: attrMatch.groups.value.trim()
      }
    };
  }

  if (/^#[^\s]+$/.test(trimmed) || /^\.[^\s]+$/.test(trimmed) || /\s/.test(trimmed) === false) {
    return { css: trimmed };
  }

  return { text: trimmed, exactText: false };
}

function extractQuoted(text: string): string | undefined {
  const match = text.match(/"([^"]+)"/);
  if (match) {
    return match[1];
  }

  const singleMatch = text.match(/'([^']+)'/);
  return singleMatch ? singleMatch[1] : undefined;
}

function extractTrailingValue(text: string): string | undefined {
  const parts = text.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : undefined;
}
