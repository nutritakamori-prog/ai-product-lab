import { matchCommand } from "@/core/qg-command-router/qg-command-router";
import { executeQgCommand, type QgCommandResult, getCreateImplementationCandidates, getApproveOrIgnoreCandidates } from "@/services/qg-command-router";
import { resolveProjectReference, type ProjectRef } from "@/services/project-resolution";
import { selectAgentsForMission } from "@/services/agent-selection";
import { listAccessibleRepos } from "@/services/github-intelligence";
import { listProjects } from "@/services/projects";
import { createAndRunMissionEvaluation, getMissionRun, getLatestMissionRun } from "@/services/evaluation-orchestrator";
import { getRunningMissionRun, toMissionLifecycle, type MissionLifecycle } from "@/services/evaluation-mission-runs";
import { listRecommendationsForRun, getRecommendation, listRecommendations } from "@/services/recommendations";
import { analyzeTeamIntelligence } from "@/services/team-intelligence-report";
import { analyzeLabSelfAwareness } from "@/services/lab-self-awareness";
import { getRecurringFindings, getCreateValidationCandidates, type RecurringFindingItem } from "@/services/qg-command-router";
import { ADD_AGENT_MIN } from "@/core/team-architect/team-architect";
import type { EvaluationMissionInput } from "@/domain/evaluation-mission";
import type { HeadReport } from "@/core/findings/head-report";
import type { FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";
import type { TeamIntelligenceReport } from "@/core/team-intelligence/team-intelligence-report";
import type { LabSelfAwarenessReport } from "@/core/lab-self-awareness/lab-self-awareness";
import { classifyProductConcept, classifyProductConceptContinuation, explainProductConcept } from "@/core/product-understanding/product-understanding";
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

// FASE 16A — lastProductConcept is cleared by default on every reply, so
// the one branch below that actually answers Product Understanding is the
// only place that needs to set it back. Every pre-existing call site
// (~15 of them) stays untouched and automatically gets the safe behavior
// ("don't assume context from any earlier message, only the one right
// before this one" — this phase's own safety rule).
// FASE 19 — lastTeamIntelligenceIntent follows the exact same discipline.
function reply(text: string, state: BrainState, structured: QgCommandResult | null = null, signal: BrainActivitySignal = EMPTY_BRAIN_SIGNAL): BrainReply {
  return { text, state: { ...state, lastProductConcept: null, lastTeamIntelligenceIntent: null }, structured, signal };
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
//
// FASE 10 — same class of bug, found the same way: the FASE 10 brief's OWN
// canonical phrases ("O que você acha que PODEMOS melhorar?", the shorter
// "O que podemos melhorar?", and the follow-up "O que você MELHORARIA
// primeiro?") didn't match this pattern either — "podemos"/"poderíamos"
// weren't in the vale/dá alternation, "o que podemos melhorar" has no
// "você acha que" at all, and "melhoraria/mudaria/priorizaria primeiro" was
// never recognized, only the narrower "faria primeiro".
const FOLLOWUP_RECOMMENDATION =
  /\b(o que (voc[êe]s?|voce) (acha|acham|acharia) que (vale|d[áa]|podemos|poder[íi]amos) (a pena |para )?melhorar|o que podemos melhorar|o que (voc[êe]|voce) (faria|melhoraria|mudaria|priorizaria) primeiro|o que (voc[êe]|voce) recomenda)\b/i;
const AGENT_GAP = /\b(algum agente (que|para)|deveria(mos)? (criar|ter) um agente|falta (um|algum) agente|tem (algo|alguma coisa) que (voc[êe]|voce) acha que dever[íi]amos criar)\b/i;
const IMPLEMENTATION_REQUEST = /\bvamos melhorar isso\b|\bimplementa (isso|essa|esse)\b/i;
const LIST_PROJECTS_QUERY = /\bquais (projetos|sistemas)\b/i;

/**
 * FASE 12C — Team Intelligence ↔ Operational Brain. Each sub-pattern below
 * recognizes one real question the pre-existing TeamIntelligenceReport
 * (analyzeTeamIntelligence, FASE 12A — unchanged in this phase) can already
 * answer with real evidence. These are intent patterns, not single
 * keywords: TEAM_INTELLIGENCE_QUERY only fires when one of these more
 * specific shapes matches, and the branch itself still requires
 * !MISSION_TRIGGER.test(trimmed) (see interpretBrainMessage) so a mission
 * request that happens to mention "agente"/"equipe" (e.g. "avalie todos os
 * agentes") is never captured here instead of running the mission it asked
 * for.
 *
 * Deliberately checked BEFORE AGENT_GAP: a few real phrases overlap (e.g.
 * "tem algum agente que deveríamos adicionar?" also matches AGENT_GAP's own
 * "algum agente que" clause) — for those, this phase's own brief asks for
 * real Team Architect evidence (ADD_AGENT/DISABLE_AGENT/REMOVE_AGENT,
 * thresholds already documented in team-architect.ts) over the older,
 * narrower AGENT_GAP heuristic (a template for an uncovered FINDING
 * CLASSIFICATION, a different and still-intact question AGENT_GAP keeps
 * answering for phrasing that doesn't overlap).
 */
// FASE 14B — broadened to not require a fixed word order (bug found live in
// FASE 14's own end-to-end run: "E nossa equipe?", "E nossa equipe, como
// está?" and "Nossa equipe está como?" all fell through to the generic
// fallback). "equipe" and "como está/estão" are now matched independently
// of which comes first, plus the short "E/E a/qual (a|nossa) equipe"
// form for a bare mention with no "como está" at all. Checked BEFORE the
// other TEAM_INTELLIGENCE_* sub-patterns in describeTeamIntelligence's own
// dispatcher (unchanged), so the more specific intents (subutilizados,
// remover, adicionar, gap, overlap) still win whenever they also match.
//
// Deliberately no trailing \b right after (est[áa]|est[ãa]o): "está" ends
// in an accented, non-ASCII character, and JS regex's \b only recognizes
// ASCII word characters ([A-Za-z0-9_]) without the /u flag — \b right
// after "á" never matches when followed by a space, silently failing the
// whole alternative. Found live by this exact bug breaking "Como está
// nossa equipe?" the moment this pattern was first broadened. The
// surrounding `.*` already provides enough separation without a boundary
// there; "estão" (ends in the ASCII "o") never had this problem.
const TEAM_INTELLIGENCE_OVERVIEW =
  /\b(equipe|agentes)\b.*(est[áa]|est[ãa]o)|(est[áa]|est[ãa]o).*\b(equipe|agentes)\b|\bequipe est[áa] como\b|\b(e|qual) (a |nossa |nossos )?(equipe|agentes)\b\??|\bo que (voc[êe]|voce) acha (da|sobre) (nossa )?equipe\b/i;
const TEAM_INTELLIGENCE_UNDERUSED = /\bsubutilizad\w*\b|\bparados?\b|\bocios\w*\b|\bsem atividade\b/i;
// FASE 19 — "sobrando"/"sobra" added live: FASE 16B found "Existe algum
// agente que está sobrando?" being misread as AGENT_GAP (a much older,
// narrower, mission-scoped mechanism) because nothing in Team Intelligence
// recognized "sobrando" at all — the message fell through this whole
// union and only then matched AGENT_GAP's own "algum agente que" shape,
// checked much later in the router. Since TEAM_INTELLIGENCE_QUERY is
// checked first, this alone fixes the collision: the real REMOVE_AGENT/
// DISABLE_AGENT evidence (describeRemoveAgent) now wins, without ever
// touching AGENT_GAP itself.
const TEAM_INTELLIGENCE_REMOVE = /\bremover\b|\bexcluir\b|\bsobr(a|ando)\b/i;
const TEAM_INTELLIGENCE_DISABLE = /\bdesnecess[áa]ri\w*\b|\bdesativar\b/i;
// FASE 19 — "agente novo" (reversed word order) and "agente"+"faltando"
// (any order, via lookahead — same technique RETEST_QUERY/PRODUCT_WHAT_IS
// already use) added live: "Precisamos de algum agente novo?" and "Está
// faltando algum agente?" are both real, natural ways to ask the same
// ADD_AGENT question the original phrasing ("novo agente") never covered.
const TEAM_INTELLIGENCE_ADD =
  /\bagente\b.*\b(adicionar|criar)\b|\b(adicionar|criar)\b.*\bagente\b|\bnovo agente\b|\bagente novo\b|\boutro agente\b|\bmais um agente\b|(?=.*\bagente\b)(?=.*\bfalta(ndo)?\b)/i;
const TEAM_INTELLIGENCE_GAP = /\bgaps?\b|\blacunas?\b/i;
const TEAM_INTELLIGENCE_OVERLAP = /\bsobreposi[çc][ãa]o\w*\b|\boverlap\w*\b/i;
// FASE 19 — the one genuinely new intent: "diante dessas evidências, como
// a equipe deveria evoluir?" — never covered by any of the six specific
// questions above (each answers one narrow fact; this asks for the
// Architect's own prioritized recommendations, composed from the exact
// same report.architect data, never a new computation). Order-independent
// lookaheads, same technique as the rest of this file.
const TEAM_INTELLIGENCE_EVOLUTION =
  /(?=.*\bequipe\b)(?=.*\bmelhoraria\b)|(?=.*\bequipe\b)(?=.*\bprecisa\b)(?=.*\bmudar\b)|(?=.*\bevolu[çc][ãa]o\b)(?=.*\bequipe\b)|(?=.*\bequipe\b)(?=.*\bpr[óo]xim[ao]\b)/i;
const TEAM_INTELLIGENCE_QUERY = new RegExp(
  [
    TEAM_INTELLIGENCE_OVERVIEW,
    TEAM_INTELLIGENCE_UNDERUSED,
    TEAM_INTELLIGENCE_REMOVE,
    TEAM_INTELLIGENCE_DISABLE,
    TEAM_INTELLIGENCE_ADD,
    TEAM_INTELLIGENCE_GAP,
    TEAM_INTELLIGENCE_OVERLAP,
    TEAM_INTELLIGENCE_EVOLUTION,
  ]
    .map((r) => r.source)
    .join("|"),
  "i",
);

/**
 * FASE 19 — the continuation-only counterpart to the strict classifier
 * above, exactly mirroring classifyProductConceptContinuation (FASE 16A):
 * a weak, pronoun-free follow-up like "Qual seria?" right after "Precisamos
 * de algum agente novo?" has no keyword of its own to match against — it
 * only makes sense given state.lastTeamIntelligenceIntent already being
 * set, checked by the caller, never assumed from "any earlier message".
 */
const TEAM_INTELLIGENCE_CONTINUATION = /\bqual seria\b|\bquais seriam\b|\bo que seria\b|\bconta mais\b|\bme conta mais\b/i;

/**
 * FASE 13 — LAB Self-Awareness. Questions about the LAB itself (its own
 * operational state, capabilities, limitations, problems, recent activity)
 * rather than about the agent team specifically (TEAM_INTELLIGENCE_QUERY,
 * above) or about one mission's own findings (FOLLOWUP_*, below). None of
 * these mention "agente"/"equipe" in their own canonical phrasing, so there
 * is no real overlap with TEAM_INTELLIGENCE_QUERY today — still checked
 * after it (see interpretBrainMessage) so a future phrase that happened to
 * match both would keep the team-specific answer, never silently switch.
 */
// FASE 14B — this generic form only covers the placeholder words
// "lab"/"projeto" (e.g. "Como está o LAB?", "Como está o projeto?"). It
// deliberately does NOT try to hardcode any real project name (explicitly
// forbidden by this phase's brief) — recognizing "Como está o AI Product
// Lab?" (the real resolved project's own name) is handled dynamically by
// isLabOverviewQuestion() below, which checks the message against
// state.projectName / the real result of resolveProjectReference instead
// of a fixed string.
// FASE 16B — the three original alternatives all require "como" directly
// adjacent to "está/estão" (or to "o LAB"/"o projeto" directly adjacent to
// "está"), so a real sentence that puts the subject in between ("E como o
// LAB está hoje?") fell through to the generic fallback — found live in
// FASE 16B's own grand conversation E2E. The 4th alternative is the same
// order-independent-lookahead technique RETEST_QUERY already uses: "como",
// "está/estão", and the placeholder word "lab"/"projeto" all present,
// regardless of order — never hardcodes a real project name (still
// forbidden; the real-name case stays isLabOverviewQuestion()'s job below).
const LAB_SELF_AWARENESS_OVERVIEW_GENERIC =
  /\bcomo (est[áa]|est[ãa]o) (o |a )?(lab|projeto)\b|\bcomo (o |a )?(lab|projeto) est[áa] funcionando\b|\bestado (atual )?d[oa] (lab|projeto)\b|(?=.*\bcomo\b)(?=.*\b(est[áa]|est[ãa]o))(?=.*\b(lab|projeto)\b)/i;
const LAB_SELF_AWARENESS_WORKING_WELL = /\bo que est[áa] funcionando\b/i;
const LAB_SELF_AWARENESS_LIMITATIONS = /\bo que o lab ainda n[ãa]o consegue fazer\b|\b(nossas?|as) limita[çc][õo]es\b/i;
const LAB_SELF_AWARENESS_CAPABILITIES = /\bo que o lab (j[áa] )?consegue fazer\b|\bo que (j[áa] )?conseguimos fazer\b/i;
const LAB_SELF_AWARENESS_PROBLEMS = /\bproblemas (atuais|principais)\b|\bo que est[áa] dando errado\b|\bonde estamos tendo problemas\b/i;
// FASE 14B — broadened from a fixed list of literal phrases to a shape:
// a question/need opener ("o que"/"tem algo que"/"alguma coisa que"),
// together with a need/should word (precisa/precisamos/deveríamos/
// devemos/podemos/poderíamos) and "melhorar" appearing anywhere after —
// found live in FASE 14's own end-to-end run that the previous, literal
// alternation didn't cover the impersonal "precisa" form at all ("O que
// ainda precisa melhorar?", "O que precisa melhorar?", "Tem algo que
// precisa melhorar?", "O que você acha que precisa melhorar?"). Still
// never matches without "melhorar" present, so it can't drift into an
// unrelated "o que..." question.
const LAB_SELF_AWARENESS_IMPROVEMENTS =
  /\b(o que|tem algo que|alguma coisa que)\b.*\b(precisa|precisamos|precisaria|dever[íi]amos|deveria|devemos|podemos|poder[íi]amos)\b.*\bmelhorar\b|\bo que (voc[êe]|voce) melhoraria\b/i;
const LAB_SELF_AWARENESS_RECENT_ACTIVITY = /\bo que (aconteceu|mudou)( recentemente)?\b|\bo que aconteceu nas [úu]ltimas avalia[çc][õo]es\b/i;
const LAB_SELF_AWARENESS_QUERY = new RegExp(
  [
    LAB_SELF_AWARENESS_OVERVIEW_GENERIC,
    LAB_SELF_AWARENESS_WORKING_WELL,
    LAB_SELF_AWARENESS_LIMITATIONS,
    LAB_SELF_AWARENESS_CAPABILITIES,
    LAB_SELF_AWARENESS_PROBLEMS,
    LAB_SELF_AWARENESS_IMPROVEMENTS,
    LAB_SELF_AWARENESS_RECENT_ACTIVITY,
  ]
    .map((r) => r.source)
    .join("|"),
  "i",
);
/**
 * The bare question shape "como está/estão", used by isLabOverviewQuestion()
 * below to decide whether it's even worth checking the message against a
 * real project name. No trailing \b right after the accented group — see
 * TEAM_INTELLIGENCE_OVERVIEW's own comment above for why that silently
 * never matches "está" followed by whitespace in JS regex.
 *
 * FASE 16B — broadened to an order-independent "como" + "está/estão"
 * signal (same reasoning as LAB_SELF_AWARENESS_OVERVIEW_GENERIC just
 * above): "Como o AI Product Lab está hoje?" puts the real project name
 * between the two words, which the old adjacency-only form missed. This
 * stays a cheap pre-filter only — isLabOverviewQuestion() below still
 * requires the real project name to actually appear in the text before
 * returning true, so broadening this alone can't misclassify anything.
 */
const HOW_IS_IT_SHAPE = /\bcomo (est[áa]|est[ãa]o)|(?=.*\bcomo\b)(?=.*\b(est[áa]|est[ãa]o))/i;

/**
 * FASE 14B — BUG 4. "Como está o AI Product Lab?" (the real resolved
 * project's own name, not the placeholder word "lab") fell through to the
 * generic fallback in FASE 14's own end-to-end run — LAB_SELF_AWARENESS_
 * OVERVIEW hardcoded the literal word "lab". Fixed without hardcoding any
 * project name: first tries the cheap, already-known context
 * (state.projectName, if this is a follow-up turn); only when that's
 * unavailable does it fall back to the same real resolution
 * (resolveProjectReference) the branch would run anyway once classified —
 * reused, not duplicated. Never claims a match without the "como está/
 * estão" shape actually present, so this stays a real intent check, not a
 * blanket "any message naming a real project is a self-awareness
 * question."
 */
async function isLabOverviewQuestion(text: string, state: BrainState): Promise<boolean> {
  if (LAB_SELF_AWARENESS_OVERVIEW_GENERIC.test(text)) return true;
  if (!HOW_IS_IT_SHAPE.test(text)) return false;

  const normalized = text.toLowerCase();
  if (state.projectName && normalized.includes(state.projectName.toLowerCase())) return true;

  const resolution = await resolveProjectReference(text);
  return resolution.status === "RESOLVED" && normalized.includes(resolution.project.name.toLowerCase());
}

// FASE 14B — BUG 5. Natural-language reteste/validação: forwards to the
// already-existing mechanism (getCreateValidationCandidates, qg-command-
// router.ts) — never a new validation concept. Order-independent (a modal
// word and an action word, matched via lookaheads so either may come
// first), plus one literal alternative ("como ficou depois da mudança")
// that names no action word at all.
const RETEST_QUERY =
  /(?=.*\b(pode|podemos|consegue|conseguimos|vamos|quero|queremos|faz|fazer)\b)(?=.*\b(reteste|retestar|validar)\b)|\bcomo (ficou|est[áa]) depois da (mudan[çc]a|implementa[çc][ãa]o)\b/i;

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

/**
 * FASE 10 — found live, testing Scenario F (a real Gemini-quota failure):
 * the raw error strings evaluation-orchestrator.ts stores (`run.error`,
 * `coverage[].error`) are whatever the external provider's API returned —
 * for Gemini that's a multi-line JSON error body with internal doc links
 * and quota metric names. Dumping that verbatim into a conversational reply
 * is exactly the "resposta técnica" item 5 of this phase's own brief warns
 * against, even though it's not literally a `missionRunId=`/`provider=`
 * field. This keeps only the human-readable lead sentence most provider
 * errors already start with (observed shape: "<sentence>: { ...raw JSON
 * body... }") and caps the length defensively for any other shape — it
 * never hides WHAT failed, only the raw payload behind it. The full raw
 * string stays exactly as persisted in the database; only the text shown in
 * a reply is shortened.
 */
function humanizeError(raw: string): string {
  const leadSentence = raw.split("{")[0].trim().replace(/[:\s]+$/, "");
  const text = leadSentence || raw.trim();
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/**
 * FASE 11 — Mission Lifecycle. The real, honest progress sentence for a
 * mission that is still RUNNING — built only from EvaluationMissionRun.
 * progress (see evaluation-orchestrator.ts's own onProgress), never a
 * timer or an estimate. Replaces the old generic "ainda está em andamento",
 * which said nothing real at all.
 */
function describeMissionProgress(lifecycle: MissionLifecycle): string {
  const total = lifecycle.requestedAgentIds.length;
  const done = lifecycle.completedAgentIds.length + lifecycle.failedAgentIds.length;
  if (done === 0 && !lifecycle.runningAgentId) return `Ainda estou analisando — ${total} agente(s) selecionado(s), nenhum concluiu ainda.`;
  if (done === 0) return `Ainda estou analisando — ${total} agente(s) selecionado(s), o primeiro está em execução agora.`;
  return `Ainda estou analisando — ${done} de ${total} agente(s) já concluíram.`;
}

async function summarizeMissionRun(missionRunId: string): Promise<string> {
  const run = await getMissionRun(missionRunId);
  if (!run) return "Não encontro mais essa missão.";
  if (run.status === "FAILED") return `A última missão falhou: ${run.error ? humanizeError(run.error) : "motivo não registrado"}.`;
  if (run.status === "RUNNING") return describeMissionProgress(toMissionLifecycle(run));

  // BLOCKED (src/services/evaluation-orchestrator.ts's own definition: every
  // requested agent's outcome was something other than SUCCESS) is NOT "no
  // problem found" — it means no agent actually completed an evaluation.
  // Reporting it as a clean result would be exactly the kind of fabricated
  // confidence the brief explicitly forbids, so it gets its own honest
  // message, citing each agent's own real error.
  if (run.status === "BLOCKED") {
    const report = run.report as unknown as FinalEvaluationReport | null;
    const reasons = (report?.coverage ?? []).map((c) => `${c.agentId}: ${c.error ? humanizeError(c.error) : c.status}`).join("; ");
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

/**
 * FASE 12C — step 3 of that phase's brief: reuses resolveProjectReference
 * exactly (no second resolution engine). Adds only the two fallback
 * branches a read-only Brain question (unlike a mission request) can
 * afford that MISSION_TRIGGER's own flow doesn't: when no project is named
 * in the message AND none is already in conversational context, it's
 * allowed to auto-resolve to the one project that exists, if there's only
 * one — never when there's more than one, which still asks rather than
 * guessing. Renamed from resolveProjectForTeamIntelligence in FASE 13: the
 * logic was never Team-Intelligence-specific, and LAB Self-Awareness
 * (FASE 13) now reuses it exactly as-is for the same reason — "o LAB" and
 * "nossa equipe" need identical project resolution, not two copies of it.
 * `topic` only changes the wording of the two real ASK messages (e.g. "da
 * equipe" vs "do LAB") — never the resolution logic itself.
 */
async function resolveProjectForBrainQuery(
  text: string,
  state: BrainState,
  topic: string,
): Promise<{ status: "RESOLVED"; project: ProjectRef } | { status: "ASK"; message: string }> {
  const resolution = await resolveProjectReference(text);
  if (resolution.status === "RESOLVED") return { status: "RESOLVED", project: resolution.project };
  if (resolution.status === "AMBIGUOUS") {
    return { status: "ASK", message: `Encontrei ${resolution.candidates.length} projetos relacionados: ${formatProjectList(resolution.candidates)}. Sobre qual deles você quer saber?` };
  }

  // NOT_FOUND — the message itself names no project.
  if (state.projectId) return { status: "RESOLVED", project: { id: state.projectId, name: state.projectName ?? "" } };
  if (resolution.existing.length === 1) return { status: "RESOLVED", project: resolution.existing[0] };
  if (resolution.existing.length === 0) return { status: "ASK", message: `Ainda não há nenhum projeto registrado para eu analisar ${topic}.` };
  return { status: "ASK", message: `Sobre qual projeto você quer saber ${topic}? Projetos existentes: ${formatProjectList(resolution.existing)}.` };
}

/**
 * FASE 12C — section 7 of the brief: never a bare "Confidence: HIGH/MEDIUM/
 * LOW/INSUFFICIENT" label. Always names the real sample size
 * (completedMissions + blockedMissions — exactly computeConfidence()'s own
 * input, team-intelligence-report.ts, never recomputed here) behind the
 * label, so a reader never mistakes a specific recommendation's own
 * confidence for the overall analysis's confidence.
 */
function confidenceContextLine(report: TeamIntelligenceReport): string {
  const n = report.evidence.completedMissions + report.evidence.blockedMissions;
  if (report.confidence === "INSUFFICIENT") return "ainda não há nenhuma missão que realmente tenha avaliado os agentes, então a confiança geral é INSUFFICIENT.";
  return `a confiança geral da análise é ${report.confidence} (${n} missão(ões) já avaliaram os agentes até agora).`;
}

function describeTeamOverview(report: TeamIntelligenceReport): string {
  const { totalAgents, enabledAgents, activeAgents } = report.team.activity;
  return `Hoje temos ${totalAgents} agente(s) (${enabledAgents} habilitado(s)). ${activeAgents} tiveram atividade real registrada nas avaliações disponíveis. ${confidenceContextLine(report)}`;
}

function describeUnderusedAgents(report: TeamIntelligenceReport): string {
  const idle = report.team.evidenceGaps.agentsWithoutActivity;
  if (idle.length === 0) return `Nenhum agente aparece sem atividade registrada até agora. ${confidenceContextLine(report)}`;
  const names = idle.map((a) => a.name).join(", ");
  return `${idle.length} agente(s) aparecem sem atividade registrada nas avaliações disponíveis: ${names}. Isso não significa que sejam desnecessários — pode ser que o tipo certo de missão para eles ainda não tenha surgido. ${confidenceContextLine(report)}`;
}

function describeDisableAgent(report: TeamIntelligenceReport): string {
  const disableRecs = report.architect.recommendations.filter((r) => r.type === "DISABLE_AGENT");
  if (disableRecs.length === 0) return `Não encontrei nenhum sinal com evidência suficiente para considerar algum agente desnecessário agora. ${confidenceContextLine(report)}`;
  const names = disableRecs.flatMap((r) => r.affectedAgents).join(", ");
  const confidences = Array.from(new Set(disableRecs.map((r) => r.confidence))).join("/");
  return `Aparece um sinal de DISABLE_AGENT (confidence ${confidences}) para: ${names} — ${confidenceContextLine(report)} Isso é uma proposta para confirmação humana e reversível, nunca uma remoção definitiva.`;
}

function describeRemoveAgent(report: TeamIntelligenceReport): string {
  const removeInsufficient = report.architect.insufficientEvidence.some((e) => e.area === "REMOVE_AGENT");
  if (!removeInsufficient) return `Ainda não há nenhum sinal relacionado a remover um agente neste projeto. ${confidenceContextLine(report)}`;
  return "Ainda não. O relatório marca insuficiência de evidência para remoção — remover (excluir) um agente é uma ação irreversível que este relatório nunca recomenda por si só; desativar (reversível, e ainda sujeito a confirmação humana) é a ação mais forte que a evidência atual sustenta.";
}

function describeAddAgent(report: TeamIntelligenceReport): string {
  const addRecs = report.architect.recommendations.filter((r) => r.type === "ADD_AGENT");
  if (addRecs.length > 0) {
    return `Sim — ${addRecs.length} sinal(is) de ADD_AGENT com evidência suficiente: ${addRecs.map((r) => r.title).join("; ")}. ${confidenceContextLine(report)}`;
  }
  const insufficient = report.architect.insufficientEvidence.filter((e) => e.area === "ADD_AGENT");
  if (insufficient.length > 0) {
    return `Ainda não. Há ${insufficient.length} área(s) observada(s) sem evidência suficiente para propor um novo agente (é preciso pelo menos ${ADD_AGENT_MIN} ocorrências recorrentes). ${confidenceContextLine(report)}`;
  }
  return `Ainda não identifiquei nenhum padrão que justifique criar um novo agente. ${confidenceContextLine(report)}`;
}

function describeCoverageGaps(report: TeamIntelligenceReport): string {
  const gapRecs = report.architect.recommendations.filter((r) => r.type === "COVERAGE_GAP" || r.type === "POSSIBLE_MISSING_SPECIALIZATION");
  if (gapRecs.length === 0) return `Não encontrei nenhum gap com evidência suficiente para reportar agora. ${confidenceContextLine(report)}`;
  const byType = new Map<string, string[]>();
  for (const r of gapRecs) {
    const list = byType.get(r.type) ?? [];
    list.push(r.affectedAgents.length > 0 ? r.affectedAgents.join(", ") : r.affectedCategories.join(", "));
    byType.set(r.type, list);
  }
  const parts = Array.from(byType.entries()).map(([type, items]) => `${type}: ${items.join(", ")}`);
  return `${gapRecs.length} gap(s) com evidência suficiente — ${parts.join("; ")}. Isso descreve ausência de atividade observada, não necessariamente um problema confirmado. ${confidenceContextLine(report)}`;
}

function describeOverlap(report: TeamIntelligenceReport): string {
  const overlapRecs = report.architect.recommendations.filter((r) => r.type === "POSSIBLE_OVERLAP");
  if (overlapRecs.length === 0) return `Não encontrei nenhuma sobreposição com evidência suficiente ainda — ou a amostra é pequena, ou os agentes realmente não convergem nos mesmos findings. ${confidenceContextLine(report)}`;
  const names = overlapRecs.map((r) => r.affectedAgents.join(" + ")).join("; ");
  return `Sim — ${overlapRecs.length} sinal(is) de sobreposição: ${names}. ${confidenceContextLine(report)}`;
}

/**
 * FASE 19 — "Como a equipe deveria evoluir?" / "o que você recomenda?". The
 * one genuinely new composition this phase adds: every other describeX
 * function answers one narrow question about a single recommendation type;
 * this one is the Architect's own prioritized view across ALL of
 * report.architect.recommendations (HIGH confidence first), reusing exactly
 * the same title/suggestedAction/rationale/confidence fields every other
 * function already reads — never a new computation, never a new ranking
 * rule beyond the existing ArchitecturalConfidence scale. An empty
 * recommendations list is itself "KEEP CURRENT TEAM" — a valid, honest
 * outcome when the evidence doesn't justify any change, never reworded as a
 * failure to find something.
 */
function describeTeamEvolution(report: TeamIntelligenceReport): string {
  const recs = report.architect.recommendations;
  if (recs.length === 0) {
    return `Com a evidência disponível hoje, minha recomendação é manter a equipe atual como está (KEEP) — não há sinal com evidência suficiente para justificar adicionar, remover, desativar ou ajustar nenhum agente agora. ${confidenceContextLine(report)}`;
  }
  const order: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const sorted = [...recs].sort((a, b) => order[a.confidence] - order[b.confidence]);
  const items = sorted.map((r, i) => `${i + 1}. [${r.type}, confidence ${r.confidence}] ${r.title} — ${r.suggestedAction}`).join(" ");
  return `Com base na evidência atual, estas são as recomendações priorizadas da equipe (evolução sugerida, não uma ação automática): ${items} ${confidenceContextLine(report)} Toda recomendação acima aguarda decisão humana — nada aqui foi executado.`;
}

/**
 * FASE 12C — the one place that reads a TeamIntelligenceReport's fields to
 * decide what to say. Every number/name here comes straight from the
 * already-computed report (analyzeTeamIntelligence, FASE 12A); this
 * function never recomputes confidence, coverage, overlap, gaps, disable
 * suggestions, add-agent thresholds, recurrence, or participation — it only
 * picks which part of the report the real question was about.
 */
function classifyTeamIntelligenceIntent(text: string): BrainState["lastTeamIntelligenceIntent"] {
  if (TEAM_INTELLIGENCE_UNDERUSED.test(text)) return "UNDERUSED";
  if (TEAM_INTELLIGENCE_REMOVE.test(text)) return "REMOVE";
  if (TEAM_INTELLIGENCE_DISABLE.test(text)) return "DISABLE";
  if (TEAM_INTELLIGENCE_ADD.test(text)) return "ADD";
  if (TEAM_INTELLIGENCE_GAP.test(text)) return "GAP";
  if (TEAM_INTELLIGENCE_OVERLAP.test(text)) return "OVERLAP";
  if (TEAM_INTELLIGENCE_EVOLUTION.test(text)) return "EVOLUTION";
  return "OVERVIEW";
}

function describeTeamIntelligenceByIntent(intent: BrainState["lastTeamIntelligenceIntent"], report: TeamIntelligenceReport): string {
  switch (intent) {
    case "UNDERUSED":
      return describeUnderusedAgents(report);
    case "REMOVE":
      return describeRemoveAgent(report);
    case "DISABLE":
      return describeDisableAgent(report);
    case "ADD":
      return describeAddAgent(report);
    case "GAP":
      return describeCoverageGaps(report);
    case "OVERLAP":
      return describeOverlap(report);
    case "EVOLUTION":
      return describeTeamEvolution(report);
    default:
      return describeTeamOverview(report);
  }
}


/**
 * FASE 13 — LAB Self-Awareness. Every real limitation this module is
 * willing to assert, each tied to a real field already on the report —
 * never a generic "things AI can't do" list (explicitly forbidden by this
 * phase's own brief, section 11). Shared by OVERVIEW, WORKING_WELL,
 * LIMITATIONS, and IMPROVEMENTS (tier 3) so the same honest list is never
 * computed two different ways.
 */
function deriveLabLimitations(report: LabSelfAwarenessReport): string[] {
  const limitations: string[] = [];
  if (!report.github.configured) {
    limitations.push("a integração com GitHub ainda não está configurada neste ambiente (falta GITHUB_API_TOKEN) — o Brain não consulta repositórios reais até que isso seja feito.");
  }
  if (report.team.confidence === "INSUFFICIENT" || report.team.confidence === "LOW") {
    limitations.push(
      `a evidência sobre a equipe neste projeto ainda é ${report.team.confidence === "INSUFFICIENT" ? "insuficiente" : "pequena"} (confidence ${report.team.confidence}) — qualquer conclusão sobre os agentes deve ser lida com cautela.`,
    );
  }
  if (report.missions.failed > 0) {
    const sample = report.recentFailureSample ? ` Exemplo real: "${humanizeError(report.recentFailureSample)}".` : "";
    limitations.push(`${report.missions.failed} missão(ões) falharam antes de chegar a avaliar os agentes — isso é uma limitação do provider de execução, nunca evidência sobre a qualidade dos agentes.${sample}`);
  }
  if (report.team.evidence.recommendationsAnalyzed === 0) {
    limitations.push("ainda não há nenhuma recommendation real neste projeto para basear uma melhoria.");
  }
  return limitations;
}

function describeLabOverview(report: LabSelfAwarenessReport): string {
  const { totalAgents, enabledAgents } = report.team.team.activity;
  const runningNote = report.runningMission
    ? ` Há uma missão em andamento agora (${report.runningMission.completedAgentIds.length}/${report.runningMission.requestedAgentIds.length} agente(s) concluído(s)).`
    : "";
  const limitations = deriveLabLimitations(report);
  const limitationNote = limitations.length > 0 ? ` A principal limitação atual é que ${limitations[0]}` : "";
  return (
    `O LAB está operacional. Temos ${totalAgents} agente(s) (${enabledAgents} habilitado(s)) neste projeto, e o Brain já consegue resolver projetos, ` +
    `acompanhar missões, analisar a equipe e apresentar recomendações para decisão humana.${runningNote}${limitationNote}`
  );
}

/**
 * FASE 13 — section 7 of the brief: "o que está funcionando?" must never
 * collapse into "tudo está funcionando" — each sentence here is labeled by
 * what kind of claim it is (FATO/EVIDÊNCIA/LIMITAÇÃO/CONCLUSÃO), so the
 * reader can tell a structural guarantee apart from a count apart from a
 * real gap apart from a synthesis. Never claims a live typecheck/lint/build
 * status — the Brain has no real-time access to CI results, and asserting
 * one from memory would be exactly the "static documentation as operational
 * evidence" this phase's brief forbids (section 6).
 */
function describeLabWorkingWell(report: LabSelfAwarenessReport): string {
  const fato =
    "FATO: o roteamento do Brain, a resolução de projeto, o acompanhamento de missões (mission lifecycle) e a análise da equipe (Team Intelligence) estão implementados e respondem com dados reais — esta própria resposta foi produzida por esse caminho.";
  const evidencia = `EVIDÊNCIA: neste projeto, ${report.missions.completed} missão(ões) foram concluídas e ${report.missions.blocked} ficaram BLOCKED, produzindo ${report.team.evidence.findingsAnalyzed} finding(s) e ${report.team.evidence.recommendationsAnalyzed} recommendation(s) reais.`;
  const limitations = deriveLabLimitations(report);
  const limitacao = limitations.length > 0 ? `LIMITAÇÃO: ${limitations.join(" ")}` : "LIMITAÇÃO: nenhuma limitação comprovada identificada agora, além do tamanho da amostra em si.";
  const conclusao = `CONCLUSÃO: o núcleo operacional funciona, mas ${report.missions.failed > 0 ? "parte das avaliações reais ainda depende da disponibilidade do provider de execução." : "ainda há pouca evidência real neste projeto para afirmar mais do que isso."}`;
  return [fato, evidencia, limitacao, conclusao].join(" ");
}

/** Only capabilities with either a structural guarantee (the code path exists and is exercised by this very reply/by existing tests) or real operational confirmation for this project — never "planned" or doc-only features. */
function describeLabCapabilities(report: LabSelfAwarenessReport): string {
  const implemented = [
    "conversar sobre o estado do LAB e da equipe via Operational Brain",
    "resolver automaticamente o projeto certo a partir do que você menciona",
    "acompanhar uma missão em andamento (mission lifecycle) sem iniciar uma segunda em paralelo",
    "analisar a equipe de agentes com evidência real (Team Intelligence / Team Architect)",
    "exigir aprovação humana explícita antes de aprovar uma recommendation ou criar uma implementation task",
  ];
  if (report.missions.completed > 0 || report.missions.blocked > 0) {
    implemented.push("executar avaliações reais com agentes e sintetizar findings/recommendations a partir delas (já fez isso neste projeto)");
  }
  if (report.github.configured) implemented.push("consultar repositórios reais no GitHub");
  const githubNote = report.github.configured ? "" : " A consulta ao GitHub já existe no código, mas ainda não está configurada neste ambiente — por ora é uma capacidade planejada, não confirmada aqui.";
  return `O LAB hoje consegue: ${implemented.join("; ")}.${githubNote}`;
}

function describeLabLimitations(report: LabSelfAwarenessReport): string {
  const limitations = deriveLabLimitations(report);
  if (limitations.length === 0) return "Não identifiquei nenhuma limitação comprovada neste momento — e não vou inventar uma lista genérica do que uma IA 'normalmente' não consegue fazer.";
  return limitations.join(" ");
}

/**
 * FASE 13 — section 8 of the brief: never fabricates a problem. Priority:
 * a real recurring finding (getRecurringFindings, already-existing service)
 * outranks a Team Architect signal, which is explicitly labeled a signal,
 * never a confirmed problem. Failed missions are reported as a separate,
 * provider-level fact — never blended into "the agents found a problem."
 */
async function describeLabProblems(report: LabSelfAwarenessReport, projectId: string): Promise<string> {
  const recurring = await getRecurringFindings(projectId);
  if (recurring.items.length > 0) {
    const sample = recurring.items.slice(0, 3).map((item: RecurringFindingItem) => `"${item.finding}" (${item.targetName ?? item.targetUrl})`).join("; ");
    return `Sim — ${recurring.items.length} finding(s) recorrente(s) confirmado(s): ${sample}.`;
  }
  const signals = report.team.architect.recommendations;
  if (signals.length > 0) {
    return `Não há nenhum finding recorrente confirmado. Há ${signals.length} sinal(is) estrutural(is) do Team Architect (${signals.map((s) => s.type).join(", ")}) — isso é um sinal, não um problema confirmado.`;
  }
  if (report.missions.failed > 0) {
    return `Não encontrei um problema comprovado nos findings disponíveis. Separadamente, ${report.missions.failed} missão(ões) falharam antes de avaliar os agentes — uma limitação do provider de execução, não evidência sobre os agentes.`;
  }
  return "Não encontrei um problema comprovado nos dados disponíveis.";
}

/**
 * FASE 13 — section 9 of the brief: strict priority order, never a
 * fabricated recommendation. 1) real PENDING recommendations (reuses
 * listRecommendations, filtered to this project — no new query) 2) real
 * recurring findings (getRecurringFindings) 3) comprovada limitations
 * (deriveLabLimitations, shared) 4) coverage gaps already produced by Team
 * Architect. "Oportunidades inferidas" (the brief's own 5th, lowest tier)
 * is deliberately never reached — this module does not infer opportunities
 * beyond already-computed evidence; the honest terminal case below is used
 * instead.
 */
async function describeLabImprovements(report: LabSelfAwarenessReport, projectId: string): Promise<string> {
  const pending = (await listRecommendations("PENDING")).filter((r) => r.missionRun.projectId === projectId);
  if (pending.length > 0) {
    return `Você já tem ${pending.length} recommendation(s) pendente(s) de decisão — a mais recente: "${pending[0].title}". ${pending[0].whyItMatters}`;
  }

  const recurring = await getRecurringFindings(projectId);
  if (recurring.items.length > 0) {
    const top = recurring.items[0];
    return `Não há recommendation pendente, mas há um finding recorrente: "${top.finding}" (${top.targetName ?? top.targetUrl}) — um bom candidato a melhoria.`;
  }

  const limitations = deriveLabLimitations(report);
  if (limitations.length > 0) {
    return `Não há recommendation ou finding recorrente pendente. Uma limitação real que vale atenção: ${limitations[0]}`;
  }

  const gapRecs = report.team.architect.recommendations.filter((r) => r.type === "COVERAGE_GAP" || r.type === "POSSIBLE_MISSING_SPECIALIZATION");
  if (gapRecs.length > 0) {
    return `Não há recommendation, finding recorrente ou limitação comprovada pendente. Há ${gapRecs.length} gap(s) de cobertura sinalizado(s) pelo Team Architect: ${gapRecs.map((r) => r.affectedAgents.join(", ")).join("; ")}.`;
  }

  return "Ainda não tenho evidência suficiente para recomendar uma mudança específica.";
}

function describeLabRecentActivity(report: LabSelfAwarenessReport): string {
  if (report.runningMission) {
    return `Uma missão está em andamento agora: ${report.runningMission.completedAgentIds.length} de ${report.runningMission.requestedAgentIds.length} agente(s) já concluíram.`;
  }
  if (!report.latestMissionRun) return "Ainda não houve nenhuma missão neste projeto.";
  const { status, createdAt, target } = report.latestMissionRun;
  const when = new Date(createdAt).toLocaleString("pt-BR");
  const targetNote = target ? `, em "${target}"` : "";
  if (status === "FAILED") {
    return `A avaliação mais recente (${when}${targetNote}) falhou antes de avaliar os agentes${report.recentFailureSample ? `: ${humanizeError(report.recentFailureSample)}` : "."}`;
  }
  if (status === "BLOCKED") return `A avaliação mais recente (${when}${targetNote}) terminou BLOCKED — nenhum agente conseguiu concluir.`;
  if (status === "RUNNING") return `A avaliação mais recente (${when}${targetNote}) ainda está em andamento.`;
  return `A avaliação mais recente (${when}${targetNote}) foi concluída.`;
}

/**
 * FASE 13 — the one place that reads a LabSelfAwarenessReport's fields to
 * decide what to say. Every number/name here comes straight from the
 * already-computed report (analyzeLabSelfAwareness) or from the same
 * already-existing services (getRecurringFindings, listRecommendations)
 * every other QG command already reuses — this function never computes
 * confidence, coverage, recurrence, or participation itself.
 */
async function describeLabSelfAwareness(text: string, projectId: string, report: LabSelfAwarenessReport): Promise<string> {
  if (LAB_SELF_AWARENESS_WORKING_WELL.test(text)) return describeLabWorkingWell(report);
  if (LAB_SELF_AWARENESS_LIMITATIONS.test(text)) return describeLabLimitations(report);
  if (LAB_SELF_AWARENESS_CAPABILITIES.test(text)) return describeLabCapabilities(report);
  if (LAB_SELF_AWARENESS_PROBLEMS.test(text)) return describeLabProblems(report, projectId);
  if (LAB_SELF_AWARENESS_IMPROVEMENTS.test(text)) return describeLabImprovements(report, projectId);
  if (LAB_SELF_AWARENESS_RECENT_ACTIVITY.test(text)) return describeLabRecentActivity(report);
  return describeLabOverview(report);
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

  if (IMPLEMENTATION_REQUEST.test(trimmed)) {
    // Prefer the recommendation the conversation was just discussing
    // (lastRecommendationId, set by the FOLLOWUP_RECOMMENDATION branch
    // below); fall back to the current mission's own most recent PENDING
    // one so "vamos melhorar isso" also works said right after a mission
    // result, before any explicit "o que podemos melhorar" follow-up.
    let recommendationId = state.lastRecommendationId;
    if (!recommendationId && state.missionRunId) {
      const pending = (await listRecommendationsForRun(state.missionRunId)).find((r) => r.status === "PENDING");
      recommendationId = pending?.id ?? null;
    }

    const recommendation = recommendationId ? await getRecommendation(recommendationId) : null;
    if (!recommendation) {
      return reply("Não existe nenhuma recomendação pronta para implementação neste momento.", state);
    }
    if (!recommendation.missionRun) return reply("Não encontrei o projeto dessa recommendation.", state);

    // PENDING — the human hasn't decided on this recommendation yet, so
    // "vamos melhorar isso" starts the REAL approval step (the same
    // ACTION_CANDIDATES/confirmation-token flow the "Aprovar recomendação"
    // exact command already uses), never a bypass straight to Implementation.
    if (recommendation.status === "PENDING") {
      const candidates = await getApproveOrIgnoreCandidates();
      const single = candidates.filter((c) => c.id === recommendation.id);
      return reply(
        `Encontrei uma recomendação pendente: "${recommendation.title}". Confirme abaixo para aprová-la — a decisão humana continua sendo necessária antes de qualquer implementação.`,
        { ...state, lastRecommendationId: recommendation.id },
        { type: "ACTION_CANDIDATES", action: "APPROVE_RECOMMENDATION", candidates: single },
      );
    }

    if (recommendation.status === "IGNORED") {
      return reply(`Essa recomendação ("${recommendation.title}") já foi ignorada — não há nada pendente de implementação nela.`, state);
    }

    // APPROVED — ready for the existing Create Implementation step.
    const candidates = await getCreateImplementationCandidates(recommendation.missionRun.projectId);
    const single = candidates.filter((c) => c.recommendationId === recommendation.id);
    if (single.length === 0) {
      return reply(`A recomendação "${recommendation.title}" já está aprovada e já tem uma Implementation criada para ela.`, state);
    }
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

  // FASE 12C — Team Intelligence. Read-only: never creates a mission, never
  // mutates an Agent/Recommendation/Implementation. The MISSION_TRIGGER
  // guard keeps an actual mission request that happens to mention
  // "agente"/"equipe" (e.g. "avalie todos os agentes") routed to the real
  // mission flow below, never intercepted here instead.
  //
  // FASE 19 — a weak, pronoun-dependent follow-up ("Qual seria?" right after
  // "Precisamos de algum agente novo?") only gets routed here when
  // state.lastTeamIntelligenceIntent is already set from the immediately
  // preceding reply — never from "there was some earlier message" — same
  // continuation discipline classifyProductConceptContinuation established
  // in FASE 16A. When the strict classifier itself matches, it always wins
  // (the real intent for THIS message, not a stale one).
  const isTeamIntelligenceContinuation = !TEAM_INTELLIGENCE_QUERY.test(trimmed) && state.lastTeamIntelligenceIntent !== null && TEAM_INTELLIGENCE_CONTINUATION.test(trimmed);
  if ((TEAM_INTELLIGENCE_QUERY.test(trimmed) || isTeamIntelligenceContinuation) && !MISSION_TRIGGER.test(trimmed)) {
    const resolved = await resolveProjectForBrainQuery(trimmed, state, "a equipe");
    if (resolved.status === "ASK") return reply(resolved.message, state);

    const intent = isTeamIntelligenceContinuation ? state.lastTeamIntelligenceIntent : classifyTeamIntelligenceIntent(trimmed);
    const report = await analyzeTeamIntelligence(resolved.project.id);
    const answered = reply(describeTeamIntelligenceByIntent(intent, report), { ...state, projectId: resolved.project.id, projectName: resolved.project.name });
    return { ...answered, state: { ...answered.state, lastTeamIntelligenceIntent: intent } };
  }

  // FASE 13 — LAB Self-Awareness. Read-only, same guard discipline as Team
  // Intelligence above: never intercepts an actual mission request, and
  // never mutates anything. The MISSION_TRIGGER check is deliberately the
  // left-most operand so it short-circuits before the (possibly async,
  // FASE 14B BUG 4) isLabOverviewQuestion check ever runs for an actual
  // mission request.
  if (!MISSION_TRIGGER.test(trimmed) && (LAB_SELF_AWARENESS_QUERY.test(trimmed) || (await isLabOverviewQuestion(trimmed, state)))) {
    const resolved = await resolveProjectForBrainQuery(trimmed, state, "o LAB");
    if (resolved.status === "ASK") return reply(resolved.message, state);

    const report = await analyzeLabSelfAwareness(resolved.project.id);
    const text = await describeLabSelfAwareness(trimmed, resolved.project.id, report);
    return reply(text, { ...state, projectId: resolved.project.id, projectName: resolved.project.name });
  }

  // FASE 14B — BUG 5. Reteste/validação conversacional: forwards to the
  // already-existing, already-exact-command-reachable mechanism
  // (getCreateValidationCandidates) — never a new validation concept, never
  // a fabricated candidate when none exists.
  if (RETEST_QUERY.test(trimmed) && !MISSION_TRIGGER.test(trimmed)) {
    const resolved = await resolveProjectForBrainQuery(trimmed, state, "o reteste");
    if (resolved.status === "ASK") return reply(resolved.message, state);

    const candidates = await getCreateValidationCandidates(resolved.project.id);
    const newState = { ...state, projectId: resolved.project.id, projectName: resolved.project.name };
    if (candidates.length === 0) {
      return reply("Não há nenhuma implementation pendente de validação/reteste neste momento.", newState);
    }
    return reply(
      `Encontrei ${candidates.length} implementation(s) pronta(s) para reteste — a mais recente: "${candidates[0].recommendationTitle}". Confirme abaixo para registrar o reteste.`,
      newState,
      { type: "ACTION_CANDIDATES", action: "CREATE_VALIDATION", candidates },
    );
  }

  // FASE 15A — Product Understanding. Deliberately checked BEFORE AGENT_GAP
  // and MISSION_TRIGGER, with no !MISSION_TRIGGER guard: this is exactly
  // how the FASE 15 regression ("Como uma avaliação vira um Finding?"
  // being read as a mission request, because "avaliação" also matches
  // MISSION_TRIGGER) is fixed — by position, not by touching
  // MISSION_TRIGGER itself. classifyProductConcept's own patterns are
  // interrogative-shaped ("o que é", "qual", "como ... vira", "por que")
  // and never match the real imperative mission phrases ("Analisa X.",
  // "Avalia a performance de X."), so placing this check earlier never
  // intercepts an actual mission request — confirmed by this module's own
  // test ("never matches an imperative mission-trigger phrase"). Purely
  // conceptual/structural, never project-scoped: no database read, no
  // mutation, same answer regardless of which project is in context.
  //
  // FASE 16A — a weak, pronoun-dependent follow-up ("E os agentes?") only
  // gets the second, looser classifier when the immediately preceding
  // reply was itself Product Understanding (state.lastProductConcept) —
  // never from "there was some earlier message", and never when the
  // stronger, context-free classifier above already found nothing AND
  // there's no such context: that combination falls through to the
  // honest fallback below, exactly per this phase's own safety rule.
  const productConcept = classifyProductConcept(trimmed) ?? (state.lastProductConcept ? classifyProductConceptContinuation(trimmed) : null);
  if (productConcept) {
    const answered = reply(explainProductConcept(productConcept), state);
    return { ...answered, state: { ...answered.state, lastProductConcept: productConcept } };
  }

  if (AGENT_GAP.test(trimmed)) {
    return reply(await suggestAgentGap(state.missionRunId), state);
  }

  if (MISSION_TRIGGER.test(trimmed)) {
    // FASE 11 — Mission Lifecycle: a real EvaluationMissionRun is created
    // with status RUNNING before any agent executes (evaluation-
    // orchestrator.ts), so this is a real, DB-backed fact, not a guess —
    // never start a second mission while one is genuinely still going
    // (item 15 of this phase's own brief: "não inventar uma fila", just
    // say so honestly and describe the real one in progress).
    const alreadyRunning = await getRunningMissionRun();
    if (alreadyRunning) {
      return reply(
        `${describeMissionProgress(toMissionLifecycle(alreadyRunning))} Vou esperar essa terminar antes de iniciar outra análise.`,
        state,
      );
    }

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

    // FASE 14B — BUG 1. project.name is passed so a category keyword that
    // only appears inside the PROJECT'S OWN NAME (e.g. "Product" in "AI
    // Product Lab") is never mistaken for the user requesting that
    // specialty — see agent-selection.ts's own doc comment.
    const selection = await selectAgentsForMission(trimmed, project.name);
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
    // FASE 11 — real per-agent breakdown, straight from the just-finished
    // mission's own report.coverage (COMPLETED/BLOCKED always have one) —
    // never a guess. A FAILED run has no report at all (the orchestration
    // itself threw before consolidation could run), so both stay empty
    // rather than invented from partial state.
    const coverage = run.report?.coverage ?? [];
    const missionSignal: BrainActivitySignal = {
      agentIds: selection.agents.map((a) => a.id),
      missionStatus: run.status as "COMPLETED" | "BLOCKED" | "FAILED",
      github: null,
      completedAgentIds: coverage.filter((c) => c.status === "SUCCESS").map((c) => c.agentId),
      failedAgentIds: coverage.filter((c) => c.status !== "SUCCESS").map((c) => c.agentId),
    };

    if (run.status === "FAILED") {
      return reply(
        `Iniciei a missão com ${selection.agents.map((a) => a.name).join(", ")} em "${project.name}", mas ela falhou: ${run.error ? humanizeError(run.error) : "motivo não registrado"}. Isso não é uma falha do roteamento — é o provider de modelo configurado (externo) que não respondeu.`,
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
