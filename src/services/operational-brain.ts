import { matchCommand } from "@/core/qg-command-router/qg-command-router";
import { executeQgCommand, type QgCommandResult, getCreateImplementationCandidates } from "@/services/qg-command-router";
import { resolveProjectReference, type ProjectRef } from "@/services/project-resolution";
import { selectAgentsForMission } from "@/services/agent-selection";
import { listAccessibleRepos } from "@/services/github-intelligence";
import { listProjects } from "@/services/projects";
import { createAndRunMissionEvaluation, getMissionRun, getLatestMissionRun } from "@/services/evaluation-orchestrator";
import { listRecommendationsForRun, getRecommendation } from "@/services/recommendations";
import type { EvaluationMissionInput } from "@/domain/evaluation-mission";
import type { HeadReport } from "@/core/findings/head-report";
import type { FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";
import type { BrainState, BrainActivitySignal } from "@/services/brain-state";
import { EMPTY_BRAIN_SIGNAL } from "@/services/brain-state";

export type { BrainState, BrainActivitySignal } from "@/services/brain-state";

/**
 * BLOCO 1/2 — the Operational Brain: the first real natural-language layer
 * over the QG. It never replaces or duplicates the existing Command Center
 * infrastructure — it's the layer that decides, for a message that isn't
 * one of its known exact phrases (src/core/qg-command-router/qg-command-
 * router.ts), whether to resolve directly (reusing the exact same read
 * services the Command Router already calls) or to delegate to real agents
 * (reusing createAndRunMissionEvaluation — the exact same function Test
 * Lab's own "run a mission" button calls). It never invents an agent, a
 * project, a finding, or a GitHub repo; every number and fact in its
 * replies comes from a real row already read above.
 *
 * State is held by the CALLER (the client), not the server: each turn
 * receives the small BrainState the previous turn returned and passes an
 * updated one back. This is the same shape Server Actions already use
 * everywhere else in the QG (stateless server, state threaded by the
 * client) — no new persistence layer, no new "conversation" table, for a
 * capability this version keeps deliberately simple (see this phase's own
 * final report for why a persisted conversation history is the natural
 * next block, not built tonight).
 */


export interface BrainReply {
  text: string;
  state: BrainState;
  /** Reuses the exact same result shapes the Command Center's existing result views already render — e.g. ACTION_CANDIDATES for "vamos melhorar isso", so the existing confirm flow handles it unchanged. */
  structured?: QgCommandResult | null;
  /** Living Lab — always present (see brain-state.ts's own doc comment): the one real fact-sheet the QG's visual layer choreographs off of, never a guess about work still in progress. */
  signal: BrainActivitySignal;
}

function reply(text: string, state: BrainState, structured: QgCommandResult | null = null, signal: BrainActivitySignal = EMPTY_BRAIN_SIGNAL): BrainReply {
  return { text, state, structured, signal };
}

const GITHUB_QUERY = /\bgithub\b/i;
const MISSION_TRIGGER = /\b(analis[ae]r?|avalia[çc][ãa]o|avalie|avaliar)\b/i;
const FOLLOWUP_FINDINGS = /\b(o que (voc[êe]s|voces) (acharam|encontraram)|o que (foi )?encontrado|quais (foram os )?findings)\b/i;
const FOLLOWUP_TOP_ISSUE = /\bqual (foi|era|[ée]) o (problema|achado) mais importante\b/i;
// Found via tonight's own live BLOCO 13 replay: the ORIGINAL overnight
// brief's own canonical example phrase ("O que você acha que dá PARA
// melhorar?") didn't match the first version of this pattern — only a
// variant without "para" did. "para " and "a pena " are now both optional
// before "melhorar", so either phrasing (or neither qualifier) matches.
const FOLLOWUP_RECOMMENDATION = /\b(o que (voc[êe]|voce) (acha|acharia) que (vale|d[áa]) (a pena |para )?melhorar|o que (voc[êe]|voce) faria primeiro|o que (voc[êe]|voce) recomenda)\b/i;
const AGENT_GAP = /\b(algum agente (que|para)|deveria(mos)? (criar|ter) um agente|falta (um|algum) agente|tem (algo|alguma coisa) que (voc[êe]|voce) acha que dever[íi]amos criar)\b/i;
const IMPLEMENTATION_REQUEST = /\bvamos melhorar isso\b|\bimplementa (isso|essa|esse)\b/i;
const LIST_PROJECTS_QUERY = /\bquais (projetos|sistemas)\b/i;

/** The real, deterministic default this LAB's own domain model already documents (evaluation-mission.ts: "the LAB evaluating its own /projects page") — used only when the resolved project is this LAB itself and it has no prior mission to reuse a target from. Never applied to any other project. */
const SELF_EVALUATION_TARGET = { url: "http://localhost:3000", name: "AI Product Lab (local)" };

/**
 * Real bug found through live BLOCO 13 testing: a Brain-triggered mission
 * was passing the user's own raw conversational message (e.g. "Quero uma
 * avaliação geral. Chama quem você achar necessário.") as the mission's
 * `task` field — the field the Task Planner (task-planner.ts) turns into a
 * concrete browser Plan. The Planner's own system prompt only recognizes
 * five concrete action types and explicitly returns an empty Plan rather
 * than guess when a task doesn't "clearly describe a URL and a check" — a
 * conversational request names neither, so every such mission was reliably
 * BLOCKED regardless of correct project/agent/target resolution. Confirmed
 * against evaluation-mission-form.tsx's own task-field placeholder ("Abra o
 * sistema, clique no botão Entrar e verifique se o botão Continuar
 * aparece.") — the Evaluation Mission pipeline has always expected a
 * concrete instruction there, never the requester's intent text.
 *
 * The fix keeps the user's own words as `objective` (unchanged, still used
 * for the reply and for context) and gives the Planner a separate, generic,
 * reliably-plannable `task` instead — navigate + getText, the same two
 * action types the Planner already supports, needing no project-specific
 * knowledge the Brain doesn't have.
 */
export const DEFAULT_MISSION_TASK = "Abra a página inicial do sistema e obtenha o texto completo da página, para observar seu estado atual.";

function isSelfProject(project: ProjectRef): boolean {
  return /\blab\b/i.test(project.name);
}

async function resolveMissionTarget(project: ProjectRef): Promise<{ url: string; name?: string } | null> {
  const latest = await getLatestMissionRun();
  if (latest && latest.projectId === project.id) {
    const input = latest.input as unknown as EvaluationMissionInput;
    return input.target;
  }
  if (isSelfProject(project)) return SELF_EVALUATION_TARGET;
  return null;
}

function formatProjectList(projects: ProjectRef[]): string {
  if (projects.length === 0) return "Não encontrei nenhum projeto ainda.";
  return projects.map((p) => `"${p.name}"`).join(", ");
}

async function summarizeMissionRun(missionRunId: string): Promise<string> {
  const run = await getMissionRun(missionRunId);
  if (!run) return "Não encontro mais essa missão.";
  if (run.status === "FAILED") return `A última missão falhou: ${run.error ?? "motivo não registrado"}.`;
  if (run.status === "RUNNING") return "Essa missão ainda está em andamento.";

  // BLOCKED (src/services/evaluation-orchestrator.ts's own definition: every
  // requested agent's outcome was something other than SUCCESS) is NOT "no
  // problem found" — it means no agent actually completed an evaluation.
  // Reporting it as a clean result would be exactly the kind of fabricated
  // confidence the brief explicitly forbids, so it gets its own honest
  // message, citing each agent's own real error.
  if (run.status === "BLOCKED") {
    const report = run.report as unknown as FinalEvaluationReport | null;
    const reasons = (report?.coverage ?? []).map((c) => `${c.agentId}: ${c.error ?? c.status}`).join("; ");
    return `Nenhum agente conseguiu concluir essa missão (status BLOCKED) — não há um resultado de avaliação real para relatar.${reasons ? ` Detalhe por agente: ${reasons}.` : ""}`;
  }

  const head = run.headReport as unknown as HeadReport | null;
  if (!head || head.totalFindings === 0) {
    return "Essa missão não encontrou nenhum problema confirmado.";
  }

  const recommendations = await listRecommendationsForRun(missionRunId);
  const pending = recommendations.filter((r) => r.status === "PENDING").length;

  return `${head.summary} (${head.problems} problema(s), ${head.opportunities} oportunidade(s), ${head.observations} observação(ões); ${pending} recommendation(s) aguardando decisão de ${recommendations.length} no total).`;
}

async function topIssueForMission(missionRunId: string): Promise<string> {
  const run = await getMissionRun(missionRunId);
  const head = run?.headReport as unknown as HeadReport | null;
  if (!head || head.items.length === 0) return "Não há nenhum achado registrado nessa missão.";
  const top = head.items[0];
  return `O achado de maior prioridade foi: "${top.title}" (impacto ${top.impact ?? "não informado"}, confiança ${top.confidence ?? "não informada"}). ${top.whyItMatters}`;
}

async function recommendationForMission(missionRunId: string): Promise<{ text: string; recommendationId: string | null }> {
  const recommendations = await listRecommendationsForRun(missionRunId);
  const pending = recommendations.find((r) => r.status === "PENDING");
  if (!pending) return { text: "Não há nenhuma recommendation pendente dessa missão no momento.", recommendationId: null };
  return { text: `${pending.recommendedAction} — "${pending.title}". ${pending.whyItMatters}`, recommendationId: pending.id };
}

/** BLOCO 9 — a heuristic, deterministic gap detector: classifications the real findings use (domain/agent-output.ts's own FINDING_CLASSIFICATIONS) that have no agent category covering them (agents/system/agent-protocol.ts's own AGENT_CATEGORIES). A template, not an LLM-generated insight — disclosed as such in the final report. */
const CLASSIFICATION_TO_CATEGORY: Record<string, string | null> = {
  BUG: "QA",
  UX: "DESIGN",
  UI: "DESIGN",
  NAVIGATION: null,
  DATA: null,
  PERFORMANCE: "PERFORMANCE",
  ACCESSIBILITY: "ACCESSIBILITY",
  OPPORTUNITY: "PRODUCT",
  FUTURE_RISK: null,
};

const GAP_SUGGESTION_TEMPLATE: Record<string, string> = {
  NAVIGATION:
    "Sugestão de novo agente\nNavigation/IA Review Agent\nObjetivo: avaliar a arquitetura de navegação e a localização de funcionalidades (information architecture).\nQuando utilizar: quando findings recorrentes forem de categoria NAVIGATION, sem um agente dedicado hoje.\nO que analisar: estrutura de menus/rotas, nomeação, profundidade de navegação.\nO que não analisar: usabilidade visual (UX) ou dados (isso já é coberto por outras especialidades).",
  DATA: "Sugestão de novo agente\nData Integrity Agent\nObjetivo: avaliar a correção e consistência dos dados exibidos/persistidos.\nQuando utilizar: quando findings recorrentes forem de categoria DATA, sem um agente dedicado hoje.\nO que analisar: consistência, validação e integridade de dados.\nO que não analisar: performance ou UX (isso já é coberto por outras especialidades).",
  FUTURE_RISK:
    "Sugestão de novo agente\nArchitecture Review Agent\nObjetivo: avaliar decisões estruturais do sistema (acoplamento, duplicação, limites de responsabilidade) antes que virem risco.\nQuando utilizar: quando findings recorrentes forem de categoria FUTURE_RISK, sem um agente dedicado hoje.\nO que analisar: estrutura de módulos, dependências cruzadas, pontos de duplicação.\nO que não analisar: usabilidade visual ou comportamento em tempo de execução (isso já é coberto por UX/QA/Performance).",
};

/** BLOCO 9 — a heuristic, deterministic gap detector: reads the mission's real report.findings[].sources[].classification (the same field every agent already fills in, domain/agent-output.ts), and flags classifications no existing agent category covers (CLASSIFICATION_TO_CATEGORY above). A template per recognized gap, not an LLM-generated insight — disclosed as such. No agent is ever created automatically. */
async function suggestAgentGap(missionRunId: string | null): Promise<string> {
  if (!missionRunId) {
    return "Ainda não tenho uma missão recente para analisar lacunas — rode uma avaliação primeiro.";
  }
  const run = await getMissionRun(missionRunId);
  const report = run?.report as unknown as FinalEvaluationReport | null;
  if (!report || report.findings.length === 0) return "Não há achados suficientes nessa missão para sugerir uma nova especialidade.";

  const uncoveredClassifications = new Set<string>();
  for (const finding of report.findings) {
    for (const source of finding.sources) {
      if (source.classification && CLASSIFICATION_TO_CATEGORY[source.classification] === null) {
        uncoveredClassifications.add(source.classification);
      }
    }
  }

  if (uncoveredClassifications.size === 0) {
    return "Os findings dessa missão já se encaixam nas especialidades existentes — não identifiquei uma lacuna clara de agente.";
  }

  const suggestions = Array.from(uncoveredClassifications)
    .map((c) => GAP_SUGGESTION_TEMPLATE[c])
    .filter((s): s is string => Boolean(s));
  return `${suggestions.join("\n\n")}\n\nIsso é uma sugestão heurística baseada em categorias de finding sem agente dedicado — não foi gerada por um modelo de linguagem (sem provider disponível agora). Nenhum agente é criado automaticamente: isso exige sua aprovação explícita na Agent Library.`;
}

export async function interpretBrainMessage(message: string, state: BrainState): Promise<BrainReply> {
  const trimmed = message.trim();
  if (!trimmed) return reply("Escreva uma mensagem.", state);

  // Resolve-directly fast path: an exact known phrase still goes straight
  // through the real, unmodified Command Router — the Brain never
  // intercepts what already works.
  const knownCommand = matchCommand(trimmed);
  if (knownCommand) {
    const result = await executeQgCommand(knownCommand);
    return reply(`Comando reconhecido: ${knownCommand}.`, state, result);
  }

  if (GITHUB_QUERY.test(trimmed)) {
    const github = await listAccessibleRepos();
    if (!github.configured) {
      return reply(
        "Ainda não tenho acesso ao GitHub configurado para este LAB (falta GITHUB_API_TOKEN). Não vou inventar repositórios — configure um token para eu conseguir listar os reais.",
        state,
        null,
        { ...EMPTY_BRAIN_SIGNAL, github: { configured: false, repoCount: null } },
      );
    }
    if (!github.ok) {
      return reply(`Tentei consultar o GitHub, mas a API respondeu com um erro: ${github.error}`, state, null, {
        ...EMPTY_BRAIN_SIGNAL,
        github: { configured: true, repoCount: null },
      });
    }
    const githubSignal = { ...EMPTY_BRAIN_SIGNAL, github: { configured: true, repoCount: github.repos.length } };
    if (github.repos.length === 0) return reply("O GitHub está configurado, mas não encontrei nenhum repositório acessível.", state, null, githubSignal);
    return reply(`Encontrei ${github.repos.length} repositório(s): ${github.repos.map((r) => r.fullName).join(", ")}.`, state, null, githubSignal);
  }

  if (LIST_PROJECTS_QUERY.test(trimmed)) {
    const projects = await listProjects();
    if (projects.length === 0) return reply("Ainda não há nenhum projeto registrado no LAB.", state);
    return reply(`Projetos no LAB: ${formatProjectList(projects)}.`, state);
  }

  if (IMPLEMENTATION_REQUEST.test(trimmed) && state.lastRecommendationId) {
    const recommendation = await getRecommendation(state.lastRecommendationId);
    if (!recommendation || recommendation.status !== "APPROVED") {
      return reply(
        "Essa recommendation ainda não está aprovada — a decisão humana continua sendo necessária antes de eu poder transformar isso em uma Implementation Task.",
        state,
      );
    }
    if (!recommendation.missionRun) return reply("Não encontrei o projeto dessa recommendation.", state);
    const candidates = await getCreateImplementationCandidates(recommendation.missionRun.projectId);
    const single = candidates.filter((c) => c.recommendationId === recommendation.id);
    return reply(
      `Pronto para virar Implementation Task: "${recommendation.title}". Confirme abaixo — a execução continua exigindo sua autorização explícita.`,
      state,
      { type: "ACTION_CANDIDATES", action: "CREATE_IMPLEMENTATION", candidates: single },
    );
  }

  if (FOLLOWUP_TOP_ISSUE.test(trimmed) && state.missionRunId) {
    return reply(await topIssueForMission(state.missionRunId), state);
  }

  if (FOLLOWUP_RECOMMENDATION.test(trimmed) && state.missionRunId) {
    const { text, recommendationId } = await recommendationForMission(state.missionRunId);
    return reply(text, { ...state, lastRecommendationId: recommendationId ?? state.lastRecommendationId });
  }

  if (FOLLOWUP_FINDINGS.test(trimmed) && state.missionRunId) {
    return reply(await summarizeMissionRun(state.missionRunId), state);
  }

  if (AGENT_GAP.test(trimmed)) {
    return reply(await suggestAgentGap(state.missionRunId), state);
  }

  if (MISSION_TRIGGER.test(trimmed)) {
    const resolution = await resolveProjectReference(trimmed);
    let project: ProjectRef | null = null;

    if (resolution.status === "RESOLVED") {
      project = resolution.project;
    } else if (resolution.status === "AMBIGUOUS") {
      return reply(`Encontrei ${resolution.candidates.length} projetos relacionados: ${formatProjectList(resolution.candidates)}. Qual deles você quer analisar?`, state);
    } else if (state.projectId) {
      // No project named in this message — fall back to the one already
      // being discussed in this conversation, never a silent switch.
      project = { id: state.projectId, name: state.projectName ?? "" };
    } else {
      return reply(
        `Não encontrei nenhum projeto com esse nome. ${resolution.existing.length > 0 ? `Projetos existentes: ${formatProjectList(resolution.existing)}.` : "Não há nenhum projeto registrado ainda."}`,
        state,
      );
    }

    const selection = await selectAgentsForMission(trimmed);
    if (selection.agents.length === 0) {
      return reply(
        "Entendi que você quer uma análise, mas não identifiquei quais especialidades envolver. Diga algo como \"analise a UX\", \"procure problemas de segurança\", ou peça uma \"avaliação geral\" para envolver todos os agentes habilitados.",
        { ...state, projectId: project.id, projectName: project.name },
      );
    }

    const target = await resolveMissionTarget(project);
    if (!target) {
      return reply(
        `Encontrei o projeto "${project.name}", mas ele ainda não tem nenhuma avaliação anterior — preciso da URL que devo avaliar.`,
        { ...state, projectId: project.id, projectName: project.name },
      );
    }

    const run = await createAndRunMissionEvaluation(
      { target, objective: trimmed, task: DEFAULT_MISSION_TASK, requestedAgents: selection.agents.map((a) => a.id) },
      { id: project.id },
    );

    const newState: BrainState = { ...state, projectId: project.id, projectName: project.name, missionRunId: run.id };
    // Living Lab — the real agents this mission actually requested, and the
    // real status it actually ended with, never a guess about one still
    // "in progress" (the orchestrator has already fully run by the time
    // this function returns; there is no partial/streaming state to show).
    // createAndRunMissionEvaluation() (evaluation-orchestrator.ts) always
    // awaits full completion before returning — its own try/catch only ever
    // persists COMPLETED/BLOCKED (try) or FAILED (catch); "RUNNING" is only
    // ever the row's initial insert value, already overwritten by the time
    // this function returns. Narrowing here, not re-deriving a new rule.
    const missionSignal: BrainActivitySignal = {
      agentIds: selection.agents.map((a) => a.id),
      missionStatus: run.status as "COMPLETED" | "BLOCKED" | "FAILED",
      github: null,
    };

    if (run.status === "FAILED") {
      return reply(
        `Iniciei a missão com ${selection.agents.map((a) => a.name).join(", ")} em "${project.name}", mas ela falhou: ${run.error}. Isso não é uma falha do roteamento — é o provider de modelo configurado (externo) que não respondeu.`,
        newState,
        null,
        missionSignal,
      );
    }

    // "Missão concluída" only when it genuinely completed — a BLOCKED run
    // (every agent failed to run) gets summarizeMissionRun()'s own honest
    // BLOCKED wording instead, never framed as a clean result.
    const outcomePrefix = run.status === "COMPLETED" ? `Missão concluída em "${project.name}".` : `Missão em "${project.name}" terminou sem um resultado completo.`;
    return reply(`${selection.reason} ${outcomePrefix} ${await summarizeMissionRun(run.id)}`, newState, null, missionSignal);
  }

  return reply(
    "Não entendi como uma missão ou uma pergunta sobre o LAB. Você pode pedir para analisar um projeto (\"analise o LAB\"), perguntar sobre o estado atual (\"recomendações pendentes\", \"findings recorrentes\"), ou usar uma das Quick Actions abaixo.",
    state,
  );
}
