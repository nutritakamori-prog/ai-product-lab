import { testScenarioSchema, type TestScenario } from "./test-protocol";

/**
 * The UX Agent's first real Test Lab scenario. Reuses the same real
 * project-creation interaction as new-user-creates-first-project.ts (see
 * that scenario's step executor in src/core/testing/runner/test-runner.ts),
 * but evaluated from a distinct angle: not first-time impression
 * (new-user's job) and not functional correctness (qa-agent's job) — only
 * clarity of the flow, ease of finding the action, and whether the outcome
 * is understandable without friction.
 *
 * No existing scenario could be reused unmodified for this: every one of
 * them has "Novo usuário" or "QA" in its own name, which the Smart Router's
 * earlier-checked rules (src/core/orchestrator/smart-router.ts) always
 * match first. This scenario's own text is written to avoid those words
 * and naturally contain the ux-agent rule's own trigger words instead.
 */
const uxAgentEvaluatesProjectCreationFlowClarity: TestScenario = {
  id: "ux-agent-evaluates-project-creation-flow-clarity",
  name: "Avaliação de UX: clareza do fluxo de criação de projeto",
  description:
    "Avalia se a ação de criar um projeto é fácil de encontrar e se o fluxo até a confirmação final é claro e sem fricção desnecessária, a partir de observação real da interface.",
  objective:
    "Avaliar a clareza do fluxo de criação de um projeto: se a ação certa é fácil de encontrar, se o formulário é compreensível, e se o resultado final é claro, sem fricção desnecessária.",
  preconditions: ["A tela inicial da aplicação está acessível."],
  steps: [
    "Abrir a aplicação.",
    "Chegar à área de Projects pela navegação real e observar se a ação de criar um projeto é fácil de encontrar.",
    "Ler o formulário de criação e avaliar se ele é compreensível.",
    "Completar o fluxo preenchendo o nome mínimo necessário e confirmando.",
    "Observar se o resultado final é claro, sem fricção.",
  ],
  expectedOutcome:
    "A ação de criar um projeto é fácil de encontrar, o formulário é compreensível, e o resultado final do fluxo é claro, sem fricção desnecessária.",
  priority: "MEDIUM",
  category: "usability",
  agent: "ux-agent",
  enabled: true,
};

export default testScenarioSchema.parse(uxAgentEvaluatesProjectCreationFlowClarity);
