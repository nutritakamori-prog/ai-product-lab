import { afterEach, describe, expect, it, vi } from "vitest";
import * as actions from "./actions";
import {
  allAgentsUnevaluated,
  buildMissionInputFromFormData,
  canRerunMissionRun,
  hasInconclusiveOrUnexecutedAgents,
  submitEvaluationMission,
} from "./evaluation-mission-helpers";
import type { AgentEvaluationOutcome } from "@/services/evaluation-orchestrator";
import type { AgentOutput } from "@/domain/agent-output";

function form(entries: Record<string, string | string[]>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (Array.isArray(value)) {
      for (const v of value) formData.append(key, v);
    } else {
      formData.set(key, value);
    }
  }
  return formData;
}

function noFindingOutput(): AgentOutput {
  return {
    agent: "qa-agent",
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

function unconfirmedOutput(): AgentOutput {
  return {
    agent: "qa-agent",
    status: "UNCONFIRMED",
    finding: "Not enough evidence.",
    evidence: null,
    impact: null,
    recommendation: null,
    confidence: "LOW",
    classification: null,
    needsOtherAgent: null,
  };
}

describe("buildMissionInputFromFormData", () => {
  it("1. accepts a valid mission's fields from a form and shapes them as runEvaluationMissionAction expects", () => {
    const mission = buildMissionInputFromFormData(
      form({
        targetUrl: "https://exemplo.com",
        objective: "Confirm the login flow works.",
        task: "Abra o sistema e verifique se existe o botão Continuar.",
        requestedAgents: ["qa-agent", "ux-agent"],
      }),
    );

    expect(mission.target).toEqual({ url: "https://exemplo.com" }); // no name given -> omitted, not an empty string
    expect(mission.objective).toBe("Confirm the login flow works.");
    expect(mission.task).toBe("Abra o sistema e verifique se existe o botão Continuar.");
    expect(mission.requestedAgents).toEqual(["qa-agent", "ux-agent"]);
  });

  it("2. includes target.name only when the field is actually filled in", () => {
    const withName = buildMissionInputFromFormData(
      form({ targetUrl: "https://exemplo.com", targetName: "Sistema Externo", objective: "O", task: "T", requestedAgents: [] }),
    );
    expect(withName.target).toEqual({ url: "https://exemplo.com", name: "Sistema Externo" });

    const withoutName = buildMissionInputFromFormData(
      form({ targetUrl: "https://exemplo.com", targetName: "  ", objective: "O", task: "T", requestedAgents: [] }),
    );
    expect(withoutName.target).toEqual({ url: "https://exemplo.com" });
  });

  it("3. collects every checked requestedAgents checkbox, in order, none invented", () => {
    const mission = buildMissionInputFromFormData(
      form({ targetUrl: "u", objective: "o", task: "t", requestedAgents: ["new-user", "qa-agent", "ux-agent"] }),
    );
    expect(mission.requestedAgents).toEqual(["new-user", "qa-agent", "ux-agent"]);
  });

  it("4. no agent checked at all results in an empty list, never a default/guessed agent", () => {
    const mission = buildMissionInputFromFormData(form({ targetUrl: "u", objective: "o", task: "t" }));
    expect(mission.requestedAgents).toEqual([]);
  });
});

describe("hasInconclusiveOrUnexecutedAgents", () => {
  it("5. false when every agent cleanly succeeded with a conclusive status (NO_FINDING)", () => {
    const coverage: AgentEvaluationOutcome[] = [{ agentId: "qa-agent", status: "SUCCESS", output: noFindingOutput(), error: null }];
    expect(hasInconclusiveOrUnexecutedAgents(coverage)).toBe(false);
  });

  it("6. true when an agent was BLOCKED", () => {
    const coverage: AgentEvaluationOutcome[] = [
      { agentId: "qa-agent", status: "SUCCESS", output: noFindingOutput(), error: null },
      { agentId: "agente-inexistente", status: "BLOCKED", output: null, error: "does not exist" },
    ];
    expect(hasInconclusiveOrUnexecutedAgents(coverage)).toBe(true);
  });

  it("7. true when an agent FAILED", () => {
    const coverage: AgentEvaluationOutcome[] = [{ agentId: "qa-agent", status: "FAILED", output: null, error: "model error" }];
    expect(hasInconclusiveOrUnexecutedAgents(coverage)).toBe(true);
  });

  it("8. true when an agent's own AgentOutput status is UNCONFIRMED", () => {
    const coverage: AgentEvaluationOutcome[] = [{ agentId: "qa-agent", status: "SUCCESS", output: unconfirmedOutput(), error: null }];
    expect(hasInconclusiveOrUnexecutedAgents(coverage)).toBe(true);
  });

  it("9. false for an empty coverage list — never invents an inconclusive state", () => {
    expect(hasInconclusiveOrUnexecutedAgents([])).toBe(false);
  });
});

describe("allAgentsUnevaluated", () => {
  it("10. false when at least one agent reached a real SUCCESS", () => {
    const coverage: AgentEvaluationOutcome[] = [
      { agentId: "qa-agent", status: "SUCCESS", output: noFindingOutput(), error: null },
      { agentId: "agente-inexistente", status: "BLOCKED", output: null, error: "does not exist" },
    ];
    expect(allAgentsUnevaluated(coverage)).toBe(false);
  });

  it("11. true when every requested agent was BLOCKED (e.g. Planner failure) — reproduces a real integration-audit scenario", () => {
    const coverage: AgentEvaluationOutcome[] = [
      { agentId: "qa-agent", status: "BLOCKED", output: null, error: "Planner could not produce a Plan." },
      { agentId: "ux-agent", status: "BLOCKED", output: null, error: "Planner could not produce a Plan." },
    ];
    expect(allAgentsUnevaluated(coverage)).toBe(true);
  });

  it("12. true when every requested agent FAILED", () => {
    const coverage: AgentEvaluationOutcome[] = [{ agentId: "qa-agent", status: "FAILED", output: null, error: "model error" }];
    expect(allAgentsUnevaluated(coverage)).toBe(true);
  });

  it("13. false for an empty coverage list — that state is caught earlier by the zero-agents guard, never reported as an unevaluated mission here", () => {
    expect(allAgentsUnevaluated([])).toBe(false);
  });
});

describe("canRerunMissionRun", () => {
  it("14. true for a real, known provider other than CLAUDE_CODE (e.g. GEMINI, ANTHROPIC, MOCK)", () => {
    expect(canRerunMissionRun("GEMINI")).toBe(true);
    expect(canRerunMissionRun("ANTHROPIC")).toBe(true);
    expect(canRerunMissionRun("MOCK")).toBe(true);
  });

  it("15. false for CLAUDE_CODE — the UI must never pretend it can reproduce a Claude Code execution", () => {
    expect(canRerunMissionRun("CLAUDE_CODE")).toBe(false);
  });

  it("16. false for null — a legacy Run with no known executor is treated the same conservative way as CLAUDE_CODE, never assumed reproducible", () => {
    expect(canRerunMissionRun(null)).toBe(false);
  });
});

/**
 * submitEvaluationMission is the Evaluation Mission form's own action
 * wrapper (evaluation-mission-form.tsx uses it via useActionState) — these
 * tests prove it calls the real entry point, runEvaluationMissionAction,
 * with the mission/projectId it built, and forwards whatever that action
 * returns (success or error) unaltered. The component's own JSX rendering
 * (the form fields, the report markup) is NOT covered by an automated test:
 * this project's Vitest setup runs in a plain Node environment, with no
 * jsdom or @testing-library/react installed anywhere in the codebase, and
 * introducing that tooling for a single component would be new test
 * infrastructure this step's own instructions ask not to add. Manual
 * verification of the actual rendered page is covered separately (see this
 * turn's final report).
 */
describe("submitEvaluationMission", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("2. calls runEvaluationMissionAction with the mission built from the form and the given projectId", async () => {
    const actionSpy = vi
      .spyOn(actions, "runEvaluationMissionAction")
      .mockResolvedValue({ missionRunId: null, error: null });

    await submitEvaluationMission(
      { missionRunId: null, error: null },
      form({
        targetUrl: "https://exemplo.com",
        objective: "Objective",
        task: "Task",
        requestedAgents: ["qa-agent"],
        projectId: "project-1",
      }),
    );

    expect(actionSpy).toHaveBeenCalledTimes(1);
    const [missionArg, projectIdArg] = actionSpy.mock.calls[0];
    expect(missionArg).toMatchObject({
      target: { url: "https://exemplo.com" },
      objective: "Objective",
      task: "Task",
      requestedAgents: ["qa-agent"],
    });
    expect(projectIdArg).toBe("project-1");
  });

  it("3. forwards a successful missionRunId from runEvaluationMissionAction unaltered", async () => {
    vi.spyOn(actions, "runEvaluationMissionAction").mockResolvedValue({ missionRunId: "run-1", error: null });

    const state = await submitEvaluationMission(
      { missionRunId: null, error: null },
      form({ targetUrl: "u", objective: "o", task: "t", projectId: "project-1" }),
    );

    expect(state.missionRunId).toBe("run-1");
    expect(state.error).toBeNull();
  });

  it("8. forwards an error from runEvaluationMissionAction without exposing any stack trace, since the action itself already produces a plain message", async () => {
    vi.spyOn(actions, "runEvaluationMissionAction").mockResolvedValue({
      missionRunId: null,
      error: "Target URL is required",
    });

    const state = await submitEvaluationMission(
      { missionRunId: null, error: null },
      form({ targetUrl: "", objective: "o", task: "t", projectId: "project-1" }),
    );

    expect(state.missionRunId).toBeNull();
    expect(state.error).toBe("Target URL is required");
  });
});
