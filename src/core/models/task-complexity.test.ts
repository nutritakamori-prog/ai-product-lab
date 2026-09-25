import { describe, expect, it } from "vitest";
import { classifyTaskComplexity, selectModelTier } from "./task-complexity";

describe("classifyTaskComplexity", () => {
  it("1. tarefa simples -> LOW_COST", () => {
    expect(classifyTaskComplexity("Verifique o onboarding de um novo usuário.")).toBe("LOW_COST");
    expect(classifyTaskComplexity("Faça uma verificação simples de QA neste fluxo.")).toBe("LOW_COST");
  });

  it("2. tarefa intermediária -> BALANCED (o 'STANDARD' do enunciado)", () => {
    expect(classifyTaskComplexity("Faça uma análise de múltiplos critérios sobre este fluxo.")).toBe("BALANCED");
    expect(classifyTaskComplexity("Compare as evidências coletadas nos dois testes.")).toBe("BALANCED");
  });

  it("3. tarefa complexa -> HIGH_REASONING", () => {
    expect(classifyTaskComplexity("Precisamos de uma análise profunda deste incidente.")).toBe("HIGH_REASONING");
    expect(
      classifyTaskComplexity("Faça a síntese de múltiplas evidências coletadas nesta investigação complexa."),
    ).toBe("HIGH_REASONING");
  });

  it("4. tarefa ambígua -> LOW_COST por padrão", () => {
    expect(classifyTaskComplexity("Organize a reunião de amanhã às 10h.")).toBe("LOW_COST");
    expect(classifyTaskComplexity("")).toBe("LOW_COST");
  });

  it("5. nenhuma chamada de LLM é feita para escolher o modelo (função pura e síncrona)", () => {
    // If this were async or touched a ModelProvider, it couldn't be called
    // like this — a synchronous, side-effect-free function is itself the
    // proof no model call happens to decide the tier.
    const result = classifyTaskComplexity("Qualquer tarefa.");
    expect(typeof result).toBe("string");
    expect(["LOW_COST", "BALANCED", "HIGH_REASONING"]).toContain(result);
  });
});

describe("selectModelTier", () => {
  it("escalates when the task clearly requires more than the agent's current tier", () => {
    expect(selectModelTier("Precisamos de uma análise profunda deste incidente.", "LOW_COST")).toBe(
      "HIGH_REASONING",
    );
    expect(selectModelTier("Compare as evidências coletadas.", "LOW_COST")).toBe("BALANCED");
  });

  it("7. never downgrades: keeps the agent's current tier when the task gives no clear reason for more", () => {
    expect(selectModelTier("Organize a reunião de amanhã às 10h.", "BALANCED")).toBe("BALANCED");
    expect(selectModelTier("Verifique o onboarding.", "HIGH_REASONING")).toBe("HIGH_REASONING");
    // The common real case: an agent already configured at LOW_COST, given
    // an ordinary task, stays exactly LOW_COST — current behavior preserved.
    expect(selectModelTier("Verifique o onboarding de um novo usuário.", "LOW_COST")).toBe("LOW_COST");
  });

  it("never returns something lower than what the task alone would require", () => {
    // A task that clearly needs BALANCED is never silently served by an
    // agent's LOW_COST default just because that's its configured floor.
    expect(selectModelTier("Múltiplos critérios precisam ser avaliados aqui.", "LOW_COST")).toBe("BALANCED");
  });
});
