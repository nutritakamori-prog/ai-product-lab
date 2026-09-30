import type { ModelProvider } from "./provider";

/**
 * The smallest possible bridge for "Claude Code as manual executor" (see
 * docs/DECISIONS.md and the Test Lab session logs this formalizes): a human
 * operating Claude Code reads each agent's real systemPrompt and the
 * mission's real Observations, reasons genuinely, and hands the resulting
 * Plan (for the Task Planner's own call) and AgentOutput objects (one per
 * requested agent, in order) to this function ahead of time. This provider
 * then just plays them back, in order, whenever runMissionEvaluation() (via
 * planTask()/runAgent()) asks the model provider for a structured
 * completion.
 *
 * This is deliberately NOT an API client and never will be: nothing here
 * calls out to a real "Claude Code" service, because no such API exists —
 * see docs/DECISIONS.md's note on why a ClaudeCodeModelProvider class was
 * rejected. It is used only through setModelProviderForTesting(), in
 * scripts and tests; getModelProvider() never selects it automatically and
 * never will. It does not replace MockModelProvider: that one fabricates
 * plausible-looking output for free, ordinary development; this one only
 * ever replays output a human already produced by actually reading the
 * prompt and the real evidence.
 *
 * Throws immediately when asked for more responses than were scripted,
 * rather than silently returning `undefined` — the latter would still end
 * up as a FAILED AgentExecution (runAgent's own "no data" branch), which is
 * technically not wrong, but hides the real cause (this caller
 * under-provisioned its scripted responses) behind a generic schema error.
 * A Claude-Code-executed mission must fail loudly, never pretend an agent
 * was evaluated when it wasn't (see the model-identity rule this formalizes).
 */
export function createClaudeCodeScriptedProvider(responses: readonly unknown[]): ModelProvider {
  let index = 0;
  return {
    name: "claude-code",
    completeStructured: async <T>() => {
      if (index >= responses.length) {
        throw new Error(
          `Claude Code scripted provider: call #${index + 1} was made, but only ${responses.length} response(s) were scripted ahead of time. ` +
            "This mission needs more Plan/AgentOutput data than was authored — add the missing response instead of letting this call fall through.",
        );
      }
      const data = responses[index++];
      return {
        data: data as T,
        rawText: JSON.stringify(data),
        inputTokens: 0,
        outputTokens: 0,
        stopReason: "end_turn",
      };
    },
  };
}
