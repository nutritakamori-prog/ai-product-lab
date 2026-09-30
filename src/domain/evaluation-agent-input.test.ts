import { describe, expect, it } from "vitest";
import { buildEvaluationAgentInput } from "./evaluation-agent-input";
import type { Observation } from "@/core/testing/runner/test-runner";

describe("buildEvaluationAgentInput", () => {
  it("composes a mission slice and real observations into one explicit input, unchanged", () => {
    const mission = {
      id: "mission-1",
      target: { url: "https://exemplo.com", name: "Exemplo" },
      objective: "Confirm the button appears.",
      task: "Abra https://exemplo.com e verifique se existe um botão.",
    };
    const observations: Observation[] = [
      { action: "navigate", expected: "loads", observed: "loaded", evidence: "page.goto() resolved." },
    ];

    const input = buildEvaluationAgentInput(mission, observations);

    expect(input).toEqual({ mission, observations });
  });

  it("never invents observations — an empty list stays empty", () => {
    const mission = {
      id: "mission-2",
      target: { url: "https://exemplo.com" },
      objective: "Objective",
      task: "Task",
    };

    const input = buildEvaluationAgentInput(mission, []);

    expect(input.observations).toEqual([]);
  });
});
