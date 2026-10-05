import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { selectAgentsForMission } from "./agent-selection";

describe("agent-selection (integration)", () => {
  it("selects the real ux-agent for a UX-flavored request, never a different category", async () => {
    const result = await selectAgentsForMission("Analise a UX do checkout");
    expect(result.general).toBe(false);
    expect(result.agents.map((a) => a.id)).toContain("ux-agent");
    expect(result.agents.map((a) => a.id)).not.toContain("security-agent");
  });

  it("selects the real security-agent for a security-flavored request", async () => {
    const result = await selectAgentsForMission("Procure problemas de segurança no checkout");
    expect(result.agents.map((a) => a.id)).toContain("security-agent");
  });

  it("selects every enabled real agent for an explicit general evaluation request, never a hardcoded subset", async () => {
    const result = await selectAgentsForMission("Quero uma avaliação geral. Chama quem você achar necessário.");
    expect(result.general).toBe(true);
    const enabledCount = await db.agent.count({ where: { enabled: true } });
    expect(result.agents.length).toBe(enabledCount);
  });

  it("selects nothing (never a default/random agent) when no specialty keyword is recognized", async () => {
    const result = await selectAgentsForMission("Faça alguma coisa por aí");
    expect(result.agents).toEqual([]);
    expect(result.general).toBe(false);
  });

  /**
   * FASE 14B — BUG 1, found live during FASE 14's own end-to-end run:
   * "Analisa o AI Product Lab." was narrowing to only product-agent,
   * because the word "Product" in the PROJECT'S OWN NAME matched
   * CATEGORY_KEYWORDS.PRODUCT — never because the user asked about
   * product functionality. The exact test matrix from this phase's brief.
   */
  describe("não confunde o nome do projeto com uma especialidade pedida (BUG 1)", () => {
    const PROJECT_NAME = "AI Product Lab";

    it("Geral — 'Analisa o AI Product Lab.' means a general evaluation, never product-agent only", async () => {
      const result = await selectAgentsForMission("Analisa o AI Product Lab.", PROJECT_NAME);
      expect(result.general).toBe(true);
      const enabledCount = await db.agent.count({ where: { enabled: true } });
      expect(result.agents.length).toBe(enabledCount);
    });

    it("Especialidade explícita — 'Analisa a área de Product do AI Product Lab.' still means product-agent (the word appears outside the project's own name too)", async () => {
      const result = await selectAgentsForMission("Analisa a área de Product do AI Product Lab.", PROJECT_NAME);
      expect(result.general).toBe(false);
      expect(result.agents.map((a) => a.id)).toContain("product-agent");
    });

    it("UX — 'Faz uma análise de UX do AI Product Lab.' means ux-agent", async () => {
      const result = await selectAgentsForMission("Faz uma análise de UX do AI Product Lab.", PROJECT_NAME);
      expect(result.general).toBe(false);
      expect(result.agents.map((a) => a.id)).toContain("ux-agent");
      expect(result.agents.map((a) => a.id)).not.toContain("product-agent");
    });

    it("Performance — 'Analisa a performance do AI Product Lab.' means performance-agent, never product-agent from the name", async () => {
      const result = await selectAgentsForMission("Analisa a performance do AI Product Lab.", PROJECT_NAME);
      expect(result.general).toBe(false);
      expect(result.agents.map((a) => a.id)).toContain("performance-agent");
      expect(result.agents.map((a) => a.id)).not.toContain("product-agent");
    });

    it("Geral com palavra parecida — 'Quero uma avaliação geral do AI Product Lab.' still triggers the explicit general-evaluation path, unaffected by the name", async () => {
      const result = await selectAgentsForMission("Quero uma avaliação geral do AI Product Lab.", PROJECT_NAME);
      expect(result.general).toBe(true);
      const enabledCount = await db.agent.count({ where: { enabled: true } });
      expect(result.agents.length).toBe(enabledCount);
    });

    it("without a projectName argument, behaves exactly as before (backward compatible)", async () => {
      const result = await selectAgentsForMission("Analise a UX do checkout");
      expect(result.agents.map((a) => a.id)).toContain("ux-agent");
    });
  });
});
