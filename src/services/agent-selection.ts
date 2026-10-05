import { listAgents } from "@/services/agents";
import type { ResolvedAgent } from "@/core/agents/registry";

/**
 * BLOCO 6 — which real agent category a keyword in the message implies.
 * Keyed by the exact AgentCategory strings from agents/system/agent-
 * protocol.ts (the real, existing categorization), never an invented
 * taxonomy. One agent in this project currently has each category; if a
 * category later gets a second agent, both are selected together, which is
 * the correct behavior (it's the category being requested, not one slug).
 */
const CATEGORY_KEYWORDS: Record<string, RegExp> = {
  DESIGN: /\bux\b|usabilidade|\bfluxo\b|experi[êe]ncia do usu[áa]rio|user experience/i,
  ACCESSIBILITY: /acessibilidade|accessibility|\ba11y\b/i,
  PRODUCT: /\bproduto\b|\bproduct\b|funcionalidade|\bfeature\b/i,
  SECURITY: /seguran[çc]a|\bsecurity\b|vulnerabilidade/i,
  QA: /\bqa\b|\bbug\b|qualidade|valida[çc][ãa]o|verifica[çc][ãa]o/i,
  PERFORMANCE: /performance|desempenho|lentid[ãa]o|velocidade/i,
  EXPERIENCE: /novo usu[áa]rio|onboarding|primeir[ao] (vez|experi[êe]ncia)|new user/i,
};

const GENERAL_EVALUATION =
  /avalia[çc][ãa]o geral|an[áa]lise (geral|completa)|chama quem (voc[êe]|voce) achar necess[áa]rio|avalie tudo|analise tudo|avaliação completa/i;

export interface AgentSelectionResult {
  agents: ResolvedAgent[];
  reason: string;
  /** True when GENERAL_EVALUATION matched — the UI/Brain can say "avaliação geral" instead of listing categories. */
  general: boolean;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchCategories(text: string): string[] {
  return Object.entries(CATEGORY_KEYWORDS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([category]) => category);
}

/**
 * Picks which real, currently-enabled agents are relevant to a mission from
 * the message text alone — deterministic keyword rules against each agent's
 * own real `category`. Never invents an agent, never silently defaults to
 * "everyone" unless the message explicitly asks for a general/complete
 * evaluation (the brief's own stated rule: "Não executar todos os agentes
 * por padrão").
 *
 * FASE 14B — `projectName`, when given, is stripped out before deciding
 * which categories were really mentioned. Found live in FASE 14's own
 * end-to-end run: "Analisa o AI Product Lab." was narrowing to only
 * product-agent, because the word "Product" in the project's OWN NAME
 * matched CATEGORY_KEYWORDS.PRODUCT — not because the user asked about
 * product functionality. A category that appears only inside the
 * project's name is not a real request; one that ALSO appears outside it
 * (e.g. "Analisa a área de Product do AI Product Lab.") still counts,
 * since stripping removes only that one substring, not the word itself
 * wherever else it occurs in the message.
 */
export async function selectAgentsForMission(message: string, projectName?: string): Promise<AgentSelectionResult> {
  const enabled = (await listAgents()).filter((a) => a.enabled);

  if (GENERAL_EVALUATION.test(message)) {
    return { agents: enabled, reason: "Avaliação geral pedida explicitamente — todos os agentes habilitados participam.", general: true };
  }

  const rawMatches = matchCategories(message);
  const withoutProjectName = projectName ? message.replace(new RegExp(escapeRegExp(projectName), "gi"), " ") : message;
  const matchedCategories = matchCategories(withoutProjectName);

  if (matchedCategories.length === 0) {
    if (rawMatches.length > 0) {
      // Every match came solely from inside the project's own name — the
      // user requested no real specialty, so this is a general request,
      // never a silent narrowing to whichever category the name happens
      // to contain.
      return { agents: enabled, reason: "Nenhuma especialidade específica foi pedida — avaliação geral com todos os agentes habilitados.", general: true };
    }
    return { agents: [], reason: "Nenhuma palavra-chave de especialidade reconhecida na mensagem.", general: false };
  }

  const agents = enabled.filter((a) => matchedCategories.includes(a.category));
  return {
    agents,
    reason: `Mensagem menciona ${matchedCategories.join(", ")} — selecionando o(s) agente(s) dessa(s) especialidade(s).`,
    general: false,
  };
}
