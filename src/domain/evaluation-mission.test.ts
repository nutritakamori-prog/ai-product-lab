import { describe, expect, it } from "vitest";
import { evaluationMissionSchema } from "./evaluation-mission";

describe("evaluationMissionSchema", () => {
  it("1. accepts a valid mission targeting the LAB itself", () => {
    const mission = evaluationMissionSchema.parse({
      id: "mission-1",
      target: { url: "http://localhost:3000", name: "AI Product Lab" },
      objective: "Confirm a new user can create their first project without help.",
      task: "Abra a página inicial e crie um novo projeto.",
      requestedAgents: ["new-user"],
    });

    expect(mission.target).toEqual({ url: "http://localhost:3000", name: "AI Product Lab" });
  });

  it("2. accepts a valid mission targeting a different, external system", () => {
    const mission = evaluationMissionSchema.parse({
      id: "mission-2",
      target: { url: "https://outro-sistema.com", name: "Outro Sistema" },
      objective: "Check whether the signup flow works end to end.",
      task: "Abra o site e crie uma conta nova.",
      requestedAgents: ["qa-agent"],
    });

    expect(mission.target).toEqual({ url: "https://outro-sistema.com", name: "Outro Sistema" });
  });

  it("3. accepts a mission requesting multiple agents", () => {
    const mission = evaluationMissionSchema.parse({
      id: "mission-3",
      target: { url: "https://outro-sistema.com" },
      objective: "Evaluate both first-time usability and functional correctness.",
      task: "Abra o site e avalie o fluxo de cadastro.",
      requestedAgents: ["new-user", "ux-agent", "qa-agent"],
    });

    expect(mission.requestedAgents).toEqual(["new-user", "ux-agent", "qa-agent"]);
  });

  it("4. rejects a mission with no target URL", () => {
    expect(() =>
      evaluationMissionSchema.parse({
        id: "mission-4",
        target: { url: "" },
        objective: "Objective",
        task: "Task",
        requestedAgents: ["qa-agent"],
      }),
    ).toThrow();

    expect(() =>
      evaluationMissionSchema.parse({
        id: "mission-4b",
        target: {},
        objective: "Objective",
        task: "Task",
        requestedAgents: ["qa-agent"],
      }),
    ).toThrow();
  });

  it("5. rejects a mission with no objective", () => {
    expect(() =>
      evaluationMissionSchema.parse({
        id: "mission-5",
        target: { url: "https://exemplo.com" },
        objective: "",
        task: "Task",
        requestedAgents: ["qa-agent"],
      }),
    ).toThrow();
  });

  it("6. rejects a mission with no task", () => {
    expect(() =>
      evaluationMissionSchema.parse({
        id: "mission-6",
        target: { url: "https://exemplo.com" },
        objective: "Objective",
        task: "",
        requestedAgents: ["qa-agent"],
      }),
    ).toThrow();
  });

  it("7. requires requestedAgents to be a list of strings", () => {
    expect(() =>
      evaluationMissionSchema.parse({
        id: "mission-7",
        target: { url: "https://exemplo.com" },
        objective: "Objective",
        task: "Task",
        requestedAgents: "qa-agent", // a single string, not an array
      }),
    ).toThrow();

    // An empty list is still a list — this contract doesn't require at
    // least one agent (that's a decision for whoever consumes the mission).
    const mission = evaluationMissionSchema.parse({
      id: "mission-7b",
      target: { url: "https://exemplo.com" },
      objective: "Objective",
      task: "Task",
      requestedAgents: [],
    });
    expect(Array.isArray(mission.requestedAgents)).toBe(true);
  });
});
