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
});
