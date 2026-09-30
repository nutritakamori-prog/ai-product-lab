import { describe, expect, it } from "vitest";
import { buildImplementationTask, deriveAcceptanceCriteria, formatImplementationTaskAsText, splitIntoAlternatives } from "./implementation-task";
import type { FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";
import type { EvaluationMissionInput } from "@/domain/evaluation-mission";

function fixtureReport(): FinalEvaluationReport {
  return {
    missionId: "mission-1",
    mission: {
      target: { url: "https://example.com", name: "Example" },
      objective: "Avaliar o fluxo X",
      task: "Testar o fluxo de criação",
    },
    findings: [
      {
        status: "FINDING",
        finding: "O usuário não recebe confirmação visual após enviar o formulário.",
        duplicated: true,
        sources: [
          {
            agentId: "new-user",
            evidence: "OBSERVED: nenhuma mensagem de sucesso apareceu após o submit.",
            impact: "MEDIUM",
            recommendation: "Adicionar uma confirmação visual após o envio.",
            confidence: "HIGH",
            classification: "BUG",
          },
          {
            agentId: "ux-agent",
            evidence: "OBSERVED: o usuário ficou sem feedback por 2 segundos.",
            impact: "MEDIUM",
            recommendation: "Adicionar uma confirmação visual após o envio.",
            confidence: "HIGH",
            classification: "UX",
          },
        ],
      },
    ],
    coverage: [],
  };
}

function fixtureInput(): EvaluationMissionInput {
  return {
    target: { url: "https://example.com", name: "Example" },
    objective: "Avaliar o fluxo X",
    task: "Testar o fluxo de criação",
    requestedAgents: ["new-user", "ux-agent"],
  };
}

const baseRecommendation = {
  id: "rec-1",
  missionRunId: "run-1",
  findingIndex: 0,
  title: "Adicionar confirmação visual após envio",
  summary: "O usuário não recebe confirmação visual após enviar o formulário.",
  recommendedAction: "Adicionar uma confirmação visual após o envio.",
  impact: "MEDIUM",
  confidence: "HIGH",
};

describe("buildImplementationTask", () => {
  it("derives every field from the Recommendation + the run's own report/input — nothing invented", () => {
    const task = buildImplementationTask(baseRecommendation, { input: fixtureInput(), report: fixtureReport() });

    expect(task.title).toBe(baseRecommendation.title);
    expect(task.recommendationId).toBe("rec-1");
    expect(task.missionRunId).toBe("run-1");
    expect(task.targetLabel).toBe("Example");
    expect(task.context).toContain("Example");
    expect(task.context).toContain("Avaliar o fluxo X");
    expect(task.problem).toBe("O usuário não recebe confirmação visual após enviar o formulário.");
    expect(task.evidences).toHaveLength(2);
    expect(task.evidences[0]).toEqual({
      agentId: "new-user",
      evidence: "OBSERVED: nenhuma mensagem de sucesso apareceu após o submit.",
    });
    expect(task.impact).toBe("MEDIUM");
    expect(task.confidence).toBe("HIGH");
    expect(task.agents).toEqual(["new-user", "ux-agent"]);
    expect(task.recommendedAction).toBe("Adicionar uma confirmação visual após o envio.");
  });

  it("derives grounded acceptance criteria from the recommendedAction and the problem, never inventing new requirements", () => {
    const task = buildImplementationTask(baseRecommendation, { input: fixtureInput(), report: fixtureReport() });
    expect(task.acceptanceCriteria).not.toBeNull();
    expect(task.acceptanceCriteria).toHaveLength(2);
    expect(task.acceptanceCriteria?.[0]).toContain("Adicionar uma confirmação visual após o envio.");
    expect(task.acceptanceCriteria?.[1]).toContain("O usuário não recebe confirmação visual após enviar o formulário.");
  });

  it("explicitly says it could not derive acceptance criteria when no specialist ever gave a recommendation, instead of inventing one", () => {
    const noRecommendation = {
      ...baseRecommendation,
      recommendedAction: "Nenhuma recomendação específica foi fornecida pelos especialistas.",
    };
    const task = buildImplementationTask(noRecommendation, { input: fixtureInput(), report: fixtureReport() });
    expect(task.acceptanceCriteria).toBeNull();
  });

  it("falls back to the Recommendation's own summary as the problem when the run has no report (defensive only)", () => {
    const task = buildImplementationTask(baseRecommendation, { input: fixtureInput(), report: null });
    expect(task.problem).toBe(baseRecommendation.summary);
    expect(task.evidences).toEqual([]);
    expect(task.agents).toEqual([]);
  });

  it("wires a compound ('ou'-alternative) recommendedAction into two atomic criteria end-to-end", () => {
    const compoundRecommendation = {
      ...baseRecommendation,
      recommendedAction:
        "Ou explicar objetivamente o que é o Head, ou, quando a última avaliação não tiver uma síntese, explicar por quê.",
    };
    const task = buildImplementationTask(compoundRecommendation, { input: fixtureInput(), report: fixtureReport() });
    expect(task.acceptanceCriteria).toHaveLength(3);
    expect(task.acceptanceCriteria?.[0]).toMatch(/; OU$/);
  });
});

const SIMPLE_FINDING = fixtureReport().findings[0];

describe("splitIntoAlternatives", () => {
  it("detects the leading 'Ou <A>, ou <B>' structure (the real Head Report case)", () => {
    const text =
      "Ou explicar objetivamente o que é o Head (ex.: 'Head — a síntese da equipe sobre esta avaliação'), ou, quando a última avaliação realmente não tiver uma síntese disponível, explicar por quê (ex.: 'esta avaliação foi executada antes desta funcionalidade existir'), em vez de uma mensagem que parece contradizer a confirmação de que a avaliação já terminou.";
    const result = splitIntoAlternatives(text);
    expect(result).not.toBeNull();
    expect(result?.[0]).toBe("explicar objetivamente o que é o Head (ex.: 'Head — a síntese da equipe sobre esta avaliação')");
    expect(result?.[1]).toContain("quando a última avaliação realmente não tiver uma síntese disponível");
  });

  it("detects the repeated-verb 'Verb A ou Verb B' structure", () => {
    const result = splitIntoAlternatives("Explique o Head ou explique por que ele ainda não está disponível.");
    expect(result).toEqual(["Explique o Head", "Explique por que ele ainda não está disponível."]);
  });

  it("stays conservative when 'ou' connects two verbs without an alternative-fix structure", () => {
    expect(splitIntoAlternatives("O usuário pode criar ou editar projetos.")).toBeNull();
  });

  it("stays conservative for text with no 'ou' at all", () => {
    expect(splitIntoAlternatives("Adicionar uma confirmação visual após o envio.")).toBeNull();
  });
});

describe("deriveAcceptanceCriteria", () => {
  it("1. recomendação simples -> um único critério, sem fragmentação", () => {
    const criteria = deriveAcceptanceCriteria("Adicionar uma confirmação visual após o envio.", undefined);
    expect(criteria).toHaveLength(1);
    expect(criteria?.[0]).toContain("Adicionar uma confirmação visual após o envio.");
  });

  it("2. recomendação composta -> dois critérios atômicos, marcados como alternativas com '; OU'", () => {
    const compound =
      "Ou explicar objetivamente o que é o Head (ex.: 'Head — a síntese da equipe sobre esta avaliação'), ou, quando a última avaliação realmente não tiver uma síntese disponível, explicar por quê (ex.: 'esta avaliação foi executada antes desta funcionalidade existir'), em vez de uma mensagem que parece contradizer a confirmação de que a avaliação já terminou.";
    const criteria = deriveAcceptanceCriteria(compound, undefined);
    expect(criteria).toHaveLength(2);
    expect(criteria?.[0]).toContain("explicar objetivamente o que é o Head");
    expect(criteria?.[0]).toMatch(/; OU$/);
    expect(criteria?.[1]).toContain("quando a última avaliação realmente não tiver uma síntese disponível");
    expect(criteria?.[1]).not.toMatch(/; OU$/);
  });

  it("3. texto com 'ou' sem estrutura alternativa clara -> permanece um único critério monolítico", () => {
    const criteria = deriveAcceptanceCriteria("O usuário pode criar ou editar projetos.", undefined);
    expect(criteria).toHaveLength(1);
    expect(criteria?.[0]).toContain("O usuário pode criar ou editar projetos.");
  });

  it("4. sentinel de ausência de recomendação -> nenhum critério inventado", () => {
    expect(deriveAcceptanceCriteria("Nenhuma recomendação específica foi fornecida pelos especialistas.", undefined)).toBeNull();
  });

  it("5. finding presente -> o problema também vira um critério verificável", () => {
    const criteria = deriveAcceptanceCriteria("Adicionar uma confirmação visual após o envio.", SIMPLE_FINDING);
    expect(criteria).toHaveLength(2);
    expect(criteria?.[1]).toContain(SIMPLE_FINDING.finding);
  });

  it("6. finding ausente -> continua funcionando, sem inventar um problema", () => {
    const criteria = deriveAcceptanceCriteria("Adicionar uma confirmação visual após o envio.", undefined);
    expect(criteria).toHaveLength(1);
  });

  it("7. determinismo -> mesma entrada produz sempre o mesmo resultado", () => {
    const a = deriveAcceptanceCriteria("Ou explicar X, ou explicar Y.", SIMPLE_FINDING);
    const b = deriveAcceptanceCriteria("Ou explicar X, ou explicar Y.", SIMPLE_FINDING);
    expect(a).toEqual(b);
  });
});

describe("formatImplementationTaskAsText", () => {
  it("produces a plain-text task with every section, ready to paste into Claude Code", () => {
    const task = buildImplementationTask(baseRecommendation, { input: fixtureInput(), report: fixtureReport() });
    const text = formatImplementationTaskAsText(task);

    expect(text).toContain("IMPLEMENTATION TASK");
    expect(text).toContain("Título");
    expect(text).toContain(baseRecommendation.title);
    expect(text).toContain("Contexto");
    expect(text).toContain("Problema");
    expect(text).toContain("Evidências");
    expect(text).toContain("[new-user]");
    expect(text).toContain("Impacto");
    expect(text).toContain("Confiança");
    expect(text).toContain("Identificado por");
    expect(text).toContain("new-user + ux-agent");
    expect(text).toContain("Recomendação");
    expect(text).toContain("Critérios de aceite");
    expect(text).toContain("1. ");
  });

  it("says plainly when no acceptance criteria could be derived, rather than omitting the section or inventing content", () => {
    const noRecommendation = {
      ...baseRecommendation,
      recommendedAction: "Nenhuma recomendação específica foi fornecida pelos especialistas.",
    };
    const task = buildImplementationTask(noRecommendation, { input: fixtureInput(), report: fixtureReport() });
    const text = formatImplementationTaskAsText(task);
    expect(text).toContain("Não foi possível derivar critérios de aceite específicos");
  });
});
