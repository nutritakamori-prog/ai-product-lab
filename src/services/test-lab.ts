import { db } from "@/lib/db";
import { ScenarioRegistry } from "@/core/testing/scenarios/registry";

/** Thin pass-through, same reasoning as services/agents.ts's listAgents(). */
export function listScenarios() {
  return ScenarioRegistry.list();
}

export function listTestRuns() {
  return db.testRun.findMany({
    orderBy: { createdAt: "desc" },
    include: { agent: true },
  });
}

export function getTestRun(id: string) {
  return db.testRun.findUnique({
    where: { id },
    include: { agent: true, execution: true },
  });
}

/** A TestRun's scenarioId is a scenario file's id, not a foreign key — resolve its display name defensively. */
export function getScenarioName(scenarioId: string): string {
  return ScenarioRegistry.getById(scenarioId)?.name ?? scenarioId;
}
