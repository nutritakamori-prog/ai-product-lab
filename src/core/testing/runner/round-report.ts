import { FINDING_CLASSIFICATIONS, IMPACT_LEVELS, type AgentOutput } from "@/domain/agent-output";
import type { RoundEntry, TestRoundResult } from "./round-runner";

/**
 * Turns a TestRoundResult into a plain-text consolidated report — grouping
 * by finding type and by run status, ending in a synthesized "next
 * iteration" guideline list. Pure formatting over data the agents already
 * produced during the round (via the real Agent Runtime) — no new
 * analysis happens here, and nothing here changes any state. This is what
 * gets read back when someone asks "faça uma rodada de testes no LAB".
 */
export function formatRoundReport(result: TestRoundResult): string {
  const { startedAt, finishedAt, entries, skipped } = result;
  const lines: string[] = [];

  lines.push("=== AI Product Lab — Test Round Report ===");
  lines.push(
    `Started: ${startedAt.toISOString()}  Finished: ${finishedAt.toISOString()}  Duration: ${formatDuration(startedAt, finishedAt)}`,
  );
  lines.push(`Scenarios run: ${entries.length}  Skipped: ${skipped.length}`);
  lines.push("");

  const findingEntries = entries.filter((entry): entry is RoundEntry & { finding: AgentOutput } =>
    Boolean(entry.finding),
  );

  lines.push("--- FINDINGS BY TYPE ---");
  lines.push("");
  for (const type of FINDING_CLASSIFICATIONS) {
    const forType = sortByImpact(findingEntries.filter((entry) => entry.finding.classification === type));
    lines.push(`[${type}] (${forType.length})`);
    if (forType.length === 0) {
      lines.push("  (none)");
    } else {
      forType.forEach((entry, index) => lines.push(...formatFindingBlock(entry, index + 1)));
    }
    lines.push("");
  }

  const unclassified = sortByImpact(findingEntries.filter((entry) => !entry.finding.classification));
  if (unclassified.length > 0) {
    lines.push(`[UNCLASSIFIED] (${unclassified.length})`);
    unclassified.forEach((entry, index) => lines.push(...formatFindingBlock(entry, index + 1)));
    lines.push("");
  }

  lines.push("--- ALL RUNS ---");
  for (const entry of entries) {
    lines.push(`${entry.status.padEnd(13)} ${entry.scenario.name} / ${entry.agent.name}${summarize(entry)}`);
  }
  for (const s of skipped) {
    lines.push(`SKIPPED       ${s.scenario.name} — ${s.reason}`);
  }
  lines.push("");

  lines.push("--- DIRETRIZES PARA PRÓXIMA ITERAÇÃO ---");
  const withRecommendation = sortByImpact(findingEntries.filter((entry) => entry.finding.recommendation));
  if (withRecommendation.length === 0) {
    lines.push(
      "Nenhuma recomendação nesta rodada — nenhum problema ou oportunidade foi encontrado com evidência suficiente.",
    );
  } else {
    withRecommendation.forEach((entry, index) => {
      const f = entry.finding;
      lines.push(
        `${index + 1}. [${f.classification ?? "UNCLASSIFIED"} · ${f.impact ?? "?"}] ${f.recommendation} — cenário: "${entry.scenario.name}" (test run ${entry.testRunId})`,
      );
    });
  }
  lines.push("");
  lines.push(
    "Esta seção só organiza as recomendações que os agentes já produziram nesta rodada — nenhuma alteração foi executada. A decisão de implementar é sua.",
  );

  return lines.join("\n");
}

function formatDuration(startedAt: Date, finishedAt: Date): string {
  return `${((finishedAt.getTime() - startedAt.getTime()) / 1000).toFixed(1)}s`;
}

function impactRank(impact: AgentOutput["impact"]): number {
  if (!impact) return IMPACT_LEVELS.length;
  const index = IMPACT_LEVELS.indexOf(impact);
  return index === -1 ? IMPACT_LEVELS.length : index;
}

function sortByImpact<T extends { finding: AgentOutput }>(list: T[]): T[] {
  return [...list].sort((a, b) => impactRank(a.finding.impact) - impactRank(b.finding.impact));
}

function summarize(entry: RoundEntry): string {
  if (entry.finding) return ` — ${entry.finding.finding ?? entry.finding.status}`;
  if (entry.status === "NEEDS_REVIEW") return " — agent execution failed, see test run for details";
  return "";
}

function formatFindingBlock(entry: RoundEntry & { finding: AgentOutput }, index: number): string[] {
  const f = entry.finding;
  return [
    `  ${index}. Scenario: ${entry.scenario.name}`,
    `     Agent: ${entry.agent.name}`,
    `     Type: ${f.classification ?? "—"}`,
    `     Impact: ${f.impact ?? "—"}`,
    `     Evidence: ${f.evidence ?? "—"}`,
    `     Recommendation: ${f.recommendation ?? "—"}`,
    `     Confidence: ${f.confidence}`,
    `     Test run: ${entry.testRunId}`,
  ];
}
