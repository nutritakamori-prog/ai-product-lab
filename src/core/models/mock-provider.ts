import type { ModelProvider, StructuredCompletionParams, StructuredCompletionResult } from "./provider";
import type { AgentOutput, FindingClassification } from "@/domain/agent-output";

/**
 * Phrases that mean "this step wasn't actually verified" (not automated,
 * or the browser/server automation itself broke) — never treated as
 * evidence of a product problem, only as a reason the run is inconclusive.
 * Matches the exact wording the Test Lab's step executors already use
 * (see src/core/testing/runner/test-runner.ts).
 */
// "No deterministic selector could be built for X" (task-intents.ts's
// checkElementExists / plan-executor.ts's find step, both produce this exact
// wording) means the LAB itself couldn't check anything for that element
// type — not that the page has no problem. Found during a self-evaluation
// session: without this marker, that OBSERVED text fell through to
// NO_FINDING, silently reporting "everything worked as expected" for a step
// that was never actually verified — exactly the "NOT EXECUTED must never
// look like EXECUTED SEM PROBLEMA" rule this project states elsewhere
// (see lab-task.ts) applied to the agent's own analysis, not just routing.
const INCONCLUSIVE_MARKERS = [
  /not automated/i,
  /infrastructure (failure|error)/i,
  /no deterministic selector could be built/i,
];

/**
 * Phrases that mean an OBSERVED result genuinely didn't match what was
 * expected — real, already-gathered evidence of a problem, not invented
 * here. Grounded in the exact wording the step executors produce.
 */
const NEGATIVE_MARKERS = [
  /does not contain/i,
  /did not contain/i,
  /was not found/i,
  /\bnot found\b/i,
  // "No element matching "X" was found on the page." — the exact wording
  // task-intents.ts's checkElementExists and plan-executor.ts's find step
  // both produce for a genuine absence. Found during a self-evaluation
  // session: this specific phrase doesn't contain "not found" as adjacent
  // words ("was found" is the verb phrase, negated only by the leading
  // "No element"), so it silently fell through to NO_FINDING even when the
  // real Observation showed the requested element was genuinely absent —
  // the single most common check this LAB performs.
  /no element matching/i,
  /no response/i,
  /creation failed/i,
  /\bthrew:/i,
  /not present/i,
  /not visible/i,
];

interface Analysis {
  status: "FINDING" | "NO_FINDING" | "UNCONFIRMED";
  snippet: string | null;
  classification: FindingClassification | null;
}

function classify(snippet: string): FindingClassification {
  const text = snippet.toLowerCase();
  if (/nav|link|click|discover/.test(text)) return "NAVIGATION";
  if (/form|field|fill|input/.test(text)) return "UI";
  return "BUG";
}

/**
 * Reads only the OBSERVED text the real browser automation already
 * produced (everything between "OBSERVED:" and the next "EVIDENCE:" in the
 * prompt built by src/core/testing/runner/test-runner.ts's
 * buildScenarioTask) and applies simple, explainable keyword rules. Never
 * invents an observation that isn't already in the prompt text.
 */
function analyzePrompt(prompt: string): Analysis {
  const observedChunks = prompt
    .split(/OBSERVED:/i)
    .slice(1)
    .map((chunk) => chunk.split(/EVIDENCE:/i)[0]?.trim() ?? "");

  if (observedChunks.length === 0) {
    // No structured evidence in this prompt at all — nothing to confirm
    // or deny either way.
    return { status: "UNCONFIRMED", snippet: null, classification: null };
  }

  const conclusiveChunks = observedChunks.filter(
    (chunk) => !INCONCLUSIVE_MARKERS.some((marker) => marker.test(chunk)),
  );
  const negativeChunk = conclusiveChunks.find((chunk) => NEGATIVE_MARKERS.some((marker) => marker.test(chunk)));

  if (negativeChunk) {
    const snippet = negativeChunk.split("\n")[0].slice(0, 300);
    return { status: "FINDING", snippet, classification: classify(snippet) };
  }

  const hasInconclusiveStep = conclusiveChunks.length < observedChunks.length;
  if (hasInconclusiveStep) {
    return { status: "UNCONFIRMED", snippet: null, classification: null };
  }

  return { status: "NO_FINDING", snippet: null, classification: null };
}

function buildOutput(analysis: Analysis): AgentOutput {
  if (analysis.status === "FINDING") {
    return {
      agent: "mock",
      status: "FINDING",
      finding: `Mock analysis: an observed result did not match what was expected — "${analysis.snippet}"`,
      evidence: `OBSERVED (from the real run): "${analysis.snippet}"`,
      impact: "MEDIUM",
      recommendation:
        "Re-run this scenario with the real Anthropic provider to confirm and get a proper impact/recommendation — this is a mock, low-confidence lead, not a verified judgment.",
      confidence: "MEDIUM",
      classification: analysis.classification,
      needsOtherAgent: null,
    };
  }

  if (analysis.status === "UNCONFIRMED") {
    return {
      agent: "mock",
      status: "UNCONFIRMED",
      finding:
        "Mock analysis: at least one step's evidence was inconclusive (not automated, an infrastructure failure, or no structured evidence at all) — nothing can be confirmed from it.",
      evidence: null,
      impact: null,
      recommendation: null,
      confidence: "LOW",
      classification: null,
      needsOtherAgent: null,
    };
  }

  return {
    agent: "mock",
    status: "NO_FINDING",
    finding: null,
    evidence: null,
    impact: null,
    recommendation: null,
    confidence: "MEDIUM",
    classification: null,
    needsOtherAgent: null,
  };
}

/**
 * Included verbatim in src/services/task-planner.ts's system prompt so this
 * provider can tell a Plan-generation call apart from an ordinary
 * agent-evaluation call and answer with a Plan-shaped response instead of
 * an AgentOutput-shaped one. Neither file reaches into the other's
 * internals — task-planner.ts only imports this one string.
 */
export const TASK_PLANNER_SYSTEM_MARKER = "AI Product Lab deterministic browser task planner";

/**
 * A minimal, deliberately narrow stand-in for what a real model would do for
 * the ONE task shape src/services/task-planner.ts originally asked it to
 * support ("Abra <URL> e verifique se existe <elemento>") — not a general
 * natural-language parser. Outside the two known shapes below, it answers
 * with an empty actions list, exactly like a real model told "if you can't
 * confidently represent this, return no actions" would be expected to — it
 * never guesses a Plan.
 */
const MOCK_PLAN_TASK_PATTERN = /abra\s+(\S+)\s+e\s+verifique\s+se\s+existe\s+(.+?)[.!]?(?:\n|$)/i;

/**
 * A second, still-hardcoded known shape: "Abra <URL> e clique no botão
 * Entrar e verifique se existe o botão Continuar." — one more literal
 * sentence this stand-in recognizes, not a generic "click X then find Y"
 * parser (the click/find targets below are fixed, never derived from
 * arbitrary captured text). Checked first since it's the more specific of
 * the two known shapes.
 */
const MOCK_PLAN_3_STEP_PATTERN =
  /abra\s+(\S+)\s+e\s+clique\s+no\s+bot[aã]o\s+entrar\s+e\s+verifique\s+se\s+existe\s+o\s+bot[aã]o\s+continuar[.!]?(?:\n|$)/i;

function mockPlanActions(prompt: string): { actions: unknown[] } {
  const threeStepMatch = prompt.match(MOCK_PLAN_3_STEP_PATTERN);
  if (threeStepMatch) {
    return {
      actions: [
        { action: "navigate", target: threeStepMatch[1].trim() },
        { action: "click", target: "#entrar" },
        { action: "find", target: "botão Continuar" },
      ],
    };
  }

  const match = prompt.match(MOCK_PLAN_TASK_PATTERN);
  if (!match) return { actions: [] };
  return {
    actions: [
      { action: "navigate", target: match[1].trim() },
      { action: "find", target: match[2].trim() },
    ],
  };
}

/**
 * Deterministic, offline stand-in for the real Anthropic provider — see
 * provider.ts's getModelProvider(), which uses this automatically when
 * ANTHROPIC_API_KEY isn't configured, so development can continue without
 * spending real API tokens. It never fabricates evidence: it only reads
 * the OBSERVED text the real browser automation already produced and
 * applies simple, explainable keyword rules — never a real judgment.
 * Findings from this provider are deliberately conservative
 * (impact/confidence never above MEDIUM) and say so in their own
 * recommendation text, precisely because they're not one.
 */
export class MockModelProvider implements ModelProvider {
  readonly name = "mock";

  async completeStructured<T>(params: StructuredCompletionParams<T>): Promise<StructuredCompletionResult<T>> {
    const output: unknown = params.system.includes(TASK_PLANNER_SYSTEM_MARKER)
      ? mockPlanActions(params.prompt)
      : buildOutput(analyzePrompt(params.prompt));

    return {
      data: output as unknown as T,
      rawText: JSON.stringify(output),
      // No real API call happened — token usage/cost are genuinely zero,
      // not estimated.
      inputTokens: 0,
      outputTokens: 0,
      stopReason: "end_turn",
    };
  }
}
