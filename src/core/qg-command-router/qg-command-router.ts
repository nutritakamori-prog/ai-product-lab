/**
 * FASE 11/12 — QG Runtime. The Command Router: a pure, deterministic text →
 * known-action mapper. No database access, no business logic, no LLM —
 * see docs for this phase's own explicit rule that interpretation stays
 * deterministic. This module only answers "which of the known commands, if
 * any, does this text mean?" — actually running a command (read-only or
 * state-changing) against real LAB data is src/services/qg-command-
 * router.ts / src/services/qg-action-executor.ts's job, never this file's.
 * This file is extended, never duplicated, by FASE 12's four new action
 * commands — there is still exactly one Command Router.
 */

export const QG_COMMAND_IDS = [
  "GET_LAST_CYCLE",
  "GET_RECURRING_FINDINGS",
  "GET_PENDING_RECOMMENDATIONS",
  "GET_AGENT_ACTIVITY",
  "GET_TEAM_ARCHITECT",
  "APPROVE_RECOMMENDATION",
  "IGNORE_RECOMMENDATION",
  "CREATE_IMPLEMENTATION",
  "CREATE_VALIDATION",
  "COMPLETE_IMPLEMENTATION",
  "RUN_RETEST",
] as const;
export type QgCommandId = (typeof QG_COMMAND_IDS)[number];

/**
 * FASE 12 — the subset of QgCommandId that changes state rather than just
 * reading it. Used at the action-execution boundary (src/services/qg-
 * action-executor.ts and its Server Action) as a runtime allow-list — a
 * Server Action is callable directly over the network, outside TypeScript's
 * own type checking, so this is re-validated at runtime, not just typed.
 *
 * FASE 18 — COMPLETE_IMPLEMENTATION and RUN_RETEST close the two real gaps
 * FASE 17 found: there was no conversational/QG action to mark a real
 * Implementation COMPLETED, and CREATE_VALIDATION could never attach real
 * retest evidence. Both still go through the exact same token-gated
 * confirmation flow every other action here already requires — no new
 * bypass, no new architecture.
 */
export const QG_ACTION_IDS = [
  "APPROVE_RECOMMENDATION",
  "IGNORE_RECOMMENDATION",
  "CREATE_IMPLEMENTATION",
  "CREATE_VALIDATION",
  "COMPLETE_IMPLEMENTATION",
  "RUN_RETEST",
] as const;
export type QgActionId = (typeof QG_ACTION_IDS)[number];

export function isQgActionId(value: string): value is QgActionId {
  return (QG_ACTION_IDS as readonly string[]).includes(value);
}

export interface QgCommandDefinition {
  id: QgCommandId;
  /** The exact phrase shown in the UI's Quick Actions and used as the canonical example — also always one of this command's own accepted phrases. */
  label: string;
  /** Every normalized phrase (see normalize()) that maps to this command. The first entry is always the canonical phrase from this phase's own spec. */
  phrases: string[];
}

/**
 * Trim, lowercase, collapse internal whitespace, and drop one trailing
 * sentence-ending punctuation mark — the only normalization this version
 * does. Deliberately NOT stemming, NOT removing accents, NOT fuzzy
 * matching: a command either matches one of its known phrases after this
 * normalization, or it's unknown. Keeping this literal (rather than
 * "smart") is what keeps the router itself free of any interpretation.
 */
export function normalizeCommandText(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.?!]+$/, "");
}

export const QG_COMMANDS: QgCommandDefinition[] = [
  { id: "GET_LAST_CYCLE", label: "Último ciclo", phrases: ["analise o último ciclo", "último ciclo", "ultimo ciclo"] },
  {
    id: "GET_RECURRING_FINDINGS",
    label: "Findings recorrentes",
    phrases: ["mostre os findings recorrentes", "findings recorrentes"],
  },
  {
    id: "GET_PENDING_RECOMMENDATIONS",
    label: "Recomendações pendentes",
    phrases: ["mostre as recomendações pendentes", "recomendações pendentes", "recomendacoes pendentes"],
  },
  {
    id: "GET_AGENT_ACTIVITY",
    label: "Atividade dos agentes",
    phrases: ["mostre a atividade dos agentes", "atividade dos agentes"],
  },
  { id: "GET_TEAM_ARCHITECT", label: "Team Architect", phrases: ["mostre o team architect", "team architect"] },
  {
    id: "APPROVE_RECOMMENDATION",
    label: "Aprovar recomendação",
    phrases: ["aprovar recomendação", "aprovar recomendacao", "aprovar recommendation"],
  },
  {
    id: "IGNORE_RECOMMENDATION",
    label: "Ignorar recomendação",
    phrases: ["ignorar recomendação", "ignorar recomendacao", "ignorar recommendation"],
  },
  {
    id: "CREATE_IMPLEMENTATION",
    label: "Criar implementação",
    phrases: ["criar implementação", "criar implementacao", "criar implementation"],
  },
  {
    id: "CREATE_VALIDATION",
    label: "Criar validação",
    phrases: ["criar validação", "criar validacao", "criar validation"],
  },
  {
    id: "COMPLETE_IMPLEMENTATION",
    label: "Concluir implementação",
    phrases: ["concluir implementação", "concluir implementacao", "concluir implementation", "marcar implementação como concluída"],
  },
  {
    id: "RUN_RETEST",
    label: "Validar alteração",
    phrases: ["validar alteração", "validar alteracao", "rodar reteste real", "executar reteste real"],
  },
];

const PHRASE_TO_COMMAND: Map<string, QgCommandId> = new Map(
  QG_COMMANDS.flatMap((command) => command.phrases.map((phrase) => [phrase, command.id] as const)),
);

/** The one entry point. Pure, synchronous. Returns null for any text that doesn't normalize to one of QG_COMMANDS' own known phrases — never a guess. */
export function matchCommand(input: string): QgCommandId | null {
  return PHRASE_TO_COMMAND.get(normalizeCommandText(input)) ?? null;
}
