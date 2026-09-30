import { launchBrowserAdapter, type BrowserAdapter } from "@/core/testing/runner/browser-adapter";
import type { Observation } from "@/core/testing/runner/test-runner";
import { buildElementSelector } from "@/services/task-intents";

/**
 * The smallest possible action contract — a 1:1 mirror of BrowserAdapter's
 * own verbs (navigate/click/fill/getText, plus "find" for exists()), not a
 * new abstraction on top of it. This file only EXECUTES an already-built
 * Plan; nothing here turns a task string into one — that recognition step
 * (a future task-planner.ts) doesn't exist yet.
 */
export type PlanAction =
  | { action: "navigate"; target: string }
  | { action: "find"; target: string }
  | { action: "click"; target: string }
  | { action: "fill"; target: string; value: string }
  | { action: "getText"; target: string };

export type Plan = PlanAction[];

// Matches exactly the same sentence shape as task-intents.ts's own
// CHECK_ELEMENT_EXISTS_PATTERN ("Abra <URL> e verifique se existe
// <elemento>"), anchored to the whole task. Deliberately a separate,
// standalone regex rather than an import from task-intents.ts: this
// recognizer is meant to work in isolation at this stage (see this
// function's own doc comment) and never replaces or is wired into the
// existing check-element-exists intent — the two are intentionally
// parallel, not shared, until an actual migration is decided.
const CHECK_ELEMENT_EXISTS_PATTERN = /^abra\s+(\S+)\s+e\s+verifique\s+se\s+existe\s+(.+?)[.!]?$/i;

/**
 * Turns exactly one already-supported sentence shape into a Plan — never a
 * general natural-language parser. Returns null for anything else, same
 * evidence-first spirit as task-intents.ts's recognizeIntent: an
 * unrecognized task never gets a guessed Plan.
 *
 * `url`, when given, is used as the navigate target INSTEAD of whatever the
 * sentence itself captured — never invented, since it's a real value the
 * caller already has (e.g. a separate URL field), just preferred over the
 * one repeated in the text. The sentence must still match the full pattern
 * either way; `url` never relaxes what counts as a match.
 */
export function recognizePlan(task: string, url?: string): Plan | null {
  const match = task.trim().match(CHECK_ELEMENT_EXISTS_PATTERN);
  if (!match) return null;

  const target = (url ?? match[1]).trim();
  const elementDescription = match[2].trim();
  if (!target || !elementDescription) return null;

  return [
    { action: "navigate", target },
    { action: "find", target: elementDescription },
  ];
}

async function executeStep(adapter: BrowserAdapter, step: PlanAction): Promise<Observation> {
  switch (step.action) {
    case "navigate": {
      const page = await adapter.navigate(step.target);
      return {
        action: `Open ${step.target} in a real browser (Playwright + Chromium).`,
        expected: "The page responds and renders real content.",
        observed: `Loaded ${page.url} — page.content() returned ${page.html.length} bytes of real HTML.`,
        evidence: `page.goto("${page.url}") resolved without error.`,
      };
    }

    case "find": {
      // Same deterministic description->selector mapping used by the
      // check-element-exists intent (src/services/task-intents.ts) — never
      // duplicated, never guessed differently here.
      const selector = buildElementSelector(step.target);
      if (!selector) {
        return {
          action: `Determine a reliable selector for "${step.target}".`,
          expected: `A deterministic selector could be built for "${step.target}".`,
          observed: `No deterministic selector could be built for "${step.target}".`,
          evidence: `"${step.target}" did not match any known, deterministically mappable element type.`,
        };
      }
      const found = await adapter.exists(selector);
      return {
        action: `Check whether an element matching "${step.target}" (selector: ${selector}) exists on the page.`,
        expected: `An element matching "${step.target}" is present.`,
        observed: found
          ? `An element matching "${step.target}" was found on the page.`
          : `No element matching "${step.target}" was found on the page.`,
        evidence: `exists("${selector}") -> ${found}.`,
      };
    }

    case "click": {
      await adapter.click(step.target);
      return {
        action: `Click "${step.target}".`,
        expected: `The element matching "${step.target}" is clickable and receives the click.`,
        observed: `Clicked "${step.target}" without error.`,
        evidence: `adapter.click("${step.target}") resolved without error.`,
      };
    }

    case "fill": {
      await adapter.fill(step.target, step.value);
      const readBack = await adapter.getText(step.target);
      return {
        action: `Fill "${step.target}" with "${step.value}".`,
        expected: `The field at "${step.target}" holds exactly "${step.value}" afterward.`,
        observed: `The field now reads "${readBack}".`,
        evidence: `getText("${step.target}") (the field's real inputValue) = "${readBack}".`,
      };
    }

    case "getText": {
      const text = await adapter.getText(step.target);
      return {
        action: `Read the text at "${step.target}".`,
        expected: `"${step.target}" holds real, readable content.`,
        observed: `"${step.target}" contains: "${text}".`,
        evidence: `getText("${step.target}") = "${text}".`,
      };
    }
  }
}

/**
 * Runs every action in `plan` against a real BrowserAdapter, in order,
 * turning each real result into one Observation — never invented, never
 * built before the corresponding call actually resolves. A real
 * BrowserAdapter error (bad URL, a selector that never appears for
 * click/fill/getText) propagates as a rejected promise, exactly like
 * task-intents.ts's own executeIntent — an infrastructure failure is not
 * evidence of anything about the page, so it's never caught and turned into
 * a fabricated Observation here.
 *
 * `baseUrl` is only needed to launch the browser context; when omitted, the
 * first "navigate" action's own target is used instead (the same pattern
 * task-intents.ts's check-element-exists intent already uses for an
 * external URL) — navigate() itself resolves an absolute target regardless
 * of baseUrl.
 */
export async function executePlan(plan: Plan, baseUrl?: string): Promise<Observation[]> {
  const launchUrl = baseUrl ?? (plan[0]?.action === "navigate" ? plan[0].target : undefined);
  if (!launchUrl) {
    throw new Error('executePlan needs a baseUrl, or the plan\'s first action must be "navigate".');
  }

  const adapter = await launchBrowserAdapter(launchUrl);

  try {
    const observations: Observation[] = [];
    for (const step of plan) {
      observations.push(await executeStep(adapter, step));
    }
    return observations;
  } finally {
    await adapter.close().catch(() => {});
  }
}
