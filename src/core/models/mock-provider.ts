import type { ModelProvider, StructuredCompletionParams, StructuredCompletionResult } from "./provider";
import type { AgentOutput, FindingClassification } from "@/domain/agent-output";

/**
 * Phrases that mean "this step wasn't actually verified" (not automated,
 * or the browser/server automation itself broke) — never treated as
 * evidence of a product problem, only as a reason the run is inconclusive.
 * Matches the exact wording the Test Lab's step executors already use
 * (see src/core/testing/runner/test-runner.ts).
 */
const INCONCLUSIVE_MARKERS = [/not automated/i, /infrastructure (failure|error)/i];

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
    const analysis = analyzePrompt(params.prompt);
    const output = buildOutput(analysis);

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
