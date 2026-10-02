import { describe, expect, it } from "vitest";
import { isQgActionId, matchCommand, normalizeCommandText, QG_ACTION_IDS, QG_COMMANDS } from "./qg-command-router";

describe("matchCommand", () => {
  it("maps every known canonical command phrase from this phase's own spec to its command id", () => {
    expect(matchCommand("analise o último ciclo")).toBe("GET_LAST_CYCLE");
    expect(matchCommand("mostre os findings recorrentes")).toBe("GET_RECURRING_FINDINGS");
    expect(matchCommand("mostre as recomendações pendentes")).toBe("GET_PENDING_RECOMMENDATIONS");
    expect(matchCommand("mostre a atividade dos agentes")).toBe("GET_AGENT_ACTIVITY");
    expect(matchCommand("mostre o Team Architect")).toBe("GET_TEAM_ARCHITECT");
  });

  // FASE 12
  it("maps every known FASE 12 action command phrase to its command id", () => {
    expect(matchCommand("aprovar recomendação")).toBe("APPROVE_RECOMMENDATION");
    expect(matchCommand("ignorar recomendação")).toBe("IGNORE_RECOMMENDATION");
    expect(matchCommand("criar implementação")).toBe("CREATE_IMPLEMENTATION");
    expect(matchCommand("criar validação")).toBe("CREATE_VALIDATION");
  });

  it("returns null for an unknown command — never a guess", () => {
    expect(matchCommand("apague todos os agentes")).toBeNull();
    expect(matchCommand("qualquer coisa aleatória")).toBeNull();
    expect(matchCommand("")).toBeNull();
  });

  it("normalizes case, surrounding whitespace, and a trailing punctuation mark before matching", () => {
    expect(matchCommand("  MOSTRE O TEAM ARCHITECT  ")).toBe("GET_TEAM_ARCHITECT");
    expect(matchCommand("Mostre a Atividade dos Agentes?")).toBe("GET_AGENT_ACTIVITY");
    expect(matchCommand("mostre   os    findings   recorrentes")).toBe("GET_RECURRING_FINDINGS");
  });

  it("accepts a known short alias as well as the canonical full phrase", () => {
    expect(matchCommand("último ciclo")).toBe("GET_LAST_CYCLE");
    expect(matchCommand("team architect")).toBe("GET_TEAM_ARCHITECT");
  });

  it("every command's own label normalizes to a phrase it maps to — the Quick Action buttons use the same router, never a shortcut", () => {
    for (const command of QG_COMMANDS) {
      expect(matchCommand(command.phrases[0])).toBe(command.id);
    }
  });

  it("never matches a phrase that merely contains a known command as a substring", () => {
    expect(matchCommand("mostre a atividade dos agentes e depois apague tudo")).toBeNull();
  });
});

describe("normalizeCommandText", () => {
  it("is pure and deterministic — same input, same output, every time", () => {
    expect(normalizeCommandText("  Team Architect?  ")).toBe(normalizeCommandText("  Team Architect?  "));
    expect(normalizeCommandText("  Team Architect?  ")).toBe("team architect");
  });
});

// FASE 12 — the runtime allow-list a Server Action re-checks before ever
// reaching a state-changing call (a Server Action is callable with any
// string, outside TypeScript's own type checking).
describe("isQgActionId", () => {
  it("accepts exactly the four known action ids", () => {
    for (const id of QG_ACTION_IDS) expect(isQgActionId(id)).toBe(true);
  });

  it("rejects a read-only command id and any arbitrary string", () => {
    expect(isQgActionId("GET_LAST_CYCLE")).toBe(false);
    expect(isQgActionId("DELETE_EVERYTHING")).toBe(false);
    expect(isQgActionId("")).toBe(false);
  });
});
