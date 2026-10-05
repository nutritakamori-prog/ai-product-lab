import { revalidatePath } from "next/cache";
import {
  executeQgCommand,
  type QgCommandResult,
  type RecommendationCandidate,
  type ImplementationCandidate,
  type ValidationCandidate,
  type CompleteImplementationCandidate,
  type RetestCandidate,
} from "@/services/qg-command-router";
import { executeQgAction } from "@/services/qg-action-executor";
import { createActionConfirmation, consumeActionConfirmation } from "@/services/qg-action-confirmation";
import { isQgActionId, type QgCommandId, type QgActionId } from "@/core/qg-command-router/qg-command-router";

/**
 * FASE 15B-1/15B-3 — the controlled surface a future external consumer
 * (Claude) can call to both read the LAB and, eventually, act on it.
 * Deliberately not an interpreter: callers must already know which
 * QgCommandId/QgActionId they mean (Claude does this interpretation
 * itself — see the Fase 13 audit's own conclusion that no second
 * interpreter belongs inside the LAB) — this file only gates and
 * dispatches, reusing executeQgCommand()/executeQgAction() (the exact same
 * functions the QG's own Command Center calls) rather than
 * re-implementing any query or business rule.
 *
 * Every `command`/`action` field below is typed as a loose `string`,
 * matching the same reasoning qg-action-executor.ts's
 * `executeQgAction(action: string, ...)` already uses: a future boundary
 * calling this adapter (a tool call, an HTTP body) is not bound by
 * TypeScript at runtime, so the real safety net is always the allow-list
 * checks below, never the type signature.
 */

// ── READ (FASE 15B-1) ───────────────────────────────────────────────────

export const CLAUDE_READ_ONLY_COMMAND_IDS = [
  "GET_LAST_CYCLE",
  "GET_RECURRING_FINDINGS",
  "GET_PENDING_RECOMMENDATIONS",
  "GET_AGENT_ACTIVITY",
  "GET_TEAM_ARCHITECT",
] as const satisfies readonly QgCommandId[];

export type ClaudeReadOnlyCommandId = (typeof CLAUDE_READ_ONLY_COMMAND_IDS)[number];

export function isClaudeReadOnlyCommandId(value: string): value is ClaudeReadOnlyCommandId {
  return (CLAUDE_READ_ONLY_COMMAND_IDS as readonly string[]).includes(value);
}

export interface ClaudeLabQuery {
  command: string;
}

export type ClaudeLabResponse =
  | { success: true; command: QgCommandId; result: QgCommandResult }
  | { success: false; command: string | null; error: string };

/**
 * Any command outside the five read-only ids above — including a real,
 * valid QgCommandId that happens to be a mutation (APPROVE_RECOMMENDATION,
 * IGNORE_RECOMMENDATION, CREATE_IMPLEMENTATION, CREATE_VALIDATION) — is
 * rejected before executeQgCommand() is ever called, never routed through
 * "just to see". A failure from the underlying service is reported as a
 * short, clean message — never a Prisma error or stack trace.
 */
export async function runClaudeLabQuery(query: ClaudeLabQuery): Promise<ClaudeLabResponse> {
  const { command } = query;

  if (!isClaudeReadOnlyCommandId(command)) {
    return {
      success: false,
      command: null,
      error: "Comando não permitido para este adapter — apenas comandos de leitura do LAB são aceitos.",
    };
  }

  try {
    const result = await executeQgCommand(command);
    return { success: true, command, result };
  } catch {
    return { success: false, command, error: "Não foi possível consultar os dados do LAB agora." };
  }
}

// ── ACTION CANDIDATES (FASE 15B-3) ──────────────────────────────────────
// "Which targets are eligible for this mutation?" — never a mutation
// itself. Reuses executeQgCommand(action) exactly as the Command Center
// does (the four QgActionId commands already return an ACTION_CANDIDATES
// result from it, built in FASE 12 — no new "find eligible rows" query).
// The one thing this adds: a confirmation token, minted per candidate via
// the exact same qg-action-confirmation.ts mechanism FASE 15B-2 built for
// the UI — never a locally invented token, never a bare `confirmed: true`.

export interface ClaudeActionCandidate {
  targetId: string;
  title: string;
  summary: string | null;
  impact: string | null;
  confidence: string | null;
  /** Consumes exactly one mutation, for exactly this action/targetId, before it expires. */
  token: string;
  expiresAt: number;
}

export type ClaudeLabActionCandidatesResponse =
  | { success: true; command: QgActionId; candidates: ClaudeActionCandidate[] }
  | { success: false; command: string | null; error: string };

/** Normalizes the three different candidate shapes (10B.3/10C's own types) into one — the exact same field mapping command-center.tsx's onSelect handlers already encode per action. */
function toCandidateFields(
  action: QgActionId,
  candidate: RecommendationCandidate | ImplementationCandidate | ValidationCandidate | CompleteImplementationCandidate | RetestCandidate,
): Omit<ClaudeActionCandidate, "token" | "expiresAt"> {
  if (action === "APPROVE_RECOMMENDATION" || action === "IGNORE_RECOMMENDATION") {
    const c = candidate as RecommendationCandidate;
    return { targetId: c.id, title: c.title, summary: c.summary, impact: c.impact, confidence: c.confidence };
  }
  if (action === "CREATE_IMPLEMENTATION") {
    const c = candidate as ImplementationCandidate;
    return { targetId: c.recommendationId, title: c.title, summary: c.summary, impact: c.impact, confidence: c.confidence };
  }
  if (action === "COMPLETE_IMPLEMENTATION") {
    const c = candidate as CompleteImplementationCandidate;
    return { targetId: c.implementationId, title: c.title, summary: c.summary, impact: null, confidence: null };
  }
  if (action === "RUN_RETEST") {
    const c = candidate as RetestCandidate;
    return { targetId: c.implementationId, title: c.recommendationTitle, summary: c.implementationSummary, impact: null, confidence: null };
  }
  const c = candidate as ValidationCandidate;
  return { targetId: c.implementationId, title: c.recommendationTitle, summary: c.implementationSummary, impact: null, confidence: null };
}

export interface ClaudeLabActionCandidatesQuery {
  command: string;
}

/**
 * Read-only in effect — never writes to the database. Minting a
 * confirmation token is an in-memory bookkeeping step
 * (qg-action-confirmation.ts), not a mutation: an unused token unlocks
 * nothing by itself, and nothing here calls executeQgAction().
 */
export async function runClaudeLabActionCandidates(query: ClaudeLabActionCandidatesQuery): Promise<ClaudeLabActionCandidatesResponse> {
  const { command } = query;

  if (!isQgActionId(command)) {
    return {
      success: false,
      command: null,
      error: "Ação não reconhecida — apenas as mutations existentes do LAB podem ser consultadas.",
    };
  }

  try {
    const result = await executeQgCommand(command);

    if (result.type === "NO_ACTIVE_PROJECT") {
      return { success: true, command, candidates: [] };
    }
    if (result.type !== "ACTION_CANDIDATES") {
      return { success: false, command, error: "Resposta inesperada do LAB." };
    }

    const candidates: ClaudeActionCandidate[] = result.candidates.map((candidate) => {
      const fields = toCandidateFields(command, candidate);
      const confirmation = createActionConfirmation(command, fields.targetId);
      return { ...fields, token: confirmation.token, expiresAt: confirmation.expiresAt };
    });

    return { success: true, command, candidates };
  } catch {
    return { success: false, command, error: "Não foi possível consultar candidatos do LAB agora." };
  }
}

// ── ACTION CONFIRM (FASE 15B-3) ─────────────────────────────────────────
// The only write path this adapter exposes, and it is never reachable
// without a real token minted by runClaudeLabActionCandidates above and
// validated here — this file never calls executeQgAction() except after
// consumeActionConfirmation() has already returned { valid: true }.

export interface ClaudeLabActionConfirmRequest {
  command: string;
  targetId: string;
  token: string;
}

export type ClaudeLabActionConfirmResponse =
  | { success: true; command: QgActionId; message: string }
  | { success: false; command: string | null; error: string };

export async function runClaudeLabActionConfirm(request: ClaudeLabActionConfirmRequest): Promise<ClaudeLabActionConfirmResponse> {
  const { command, targetId, token } = request;

  if (!isQgActionId(command)) {
    return { success: false, command: null, error: "Ação não reconhecida — nenhuma alteração foi feita." };
  }

  const check = consumeActionConfirmation(token, command, targetId);
  if (!check.valid) {
    return { success: false, command, error: check.reason };
  }

  let outcome: Awaited<ReturnType<typeof executeQgAction>>;
  try {
    outcome = await executeQgAction(command, targetId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Não foi possível executar esta ação agora.";
    return { success: false, command, error: message };
  }

  // FASE 15E — revalidatePath() only works inside a Next.js request
  // context (the QG's own Server Action, qg-command-actions.ts). A caller
  // invoking this adapter from a plain script (scripts/claude-lab-bridge.ts
  // / scripts/claude-lab-confirm.ts) has no such context, and
  // revalidatePath() throws there (confirmed empirically during Fase 15E:
  // the mutation above had already succeeded, but that throw — caught by
  // a single shared try/catch — turned a real success into a reported
  // failure). Revalidation is a best-effort UI cache hint, never part of
  // whether the mutation itself succeeded, so its failure must never be
  // reported as the mutation's failure.
  try {
    revalidatePath("/qg");
  } catch {
    // Intentionally swallowed — see comment above.
  }

  return { success: true, command, message: outcome.message };
}

// ── UNIFIED CONTRACT (FASE 15B-3) ───────────────────────────────────────
// What a future caller (Claude) actually sees: one request type, one
// response type, dispatched to the three functions above — none of which
// duplicate each other's checks, and only the last of which can ever
// reach executeQgAction().

export type ClaudeLabRequest =
  | { kind: "query"; command: string }
  | { kind: "action_candidates"; command: string }
  | { kind: "action_confirm"; command: string; targetId: string; token: string };

export type ClaudeLabResult =
  | ({ kind: "query" } & ClaudeLabResponse)
  | ({ kind: "action_candidates" } & ClaudeLabActionCandidatesResponse)
  | ({ kind: "action_confirm" } & ClaudeLabActionConfirmResponse)
  | { kind: "invalid"; success: false; error: string };

/**
 * FASE 15B-4 — a real caller (a tool call, an HTTP body) is not bound by
 * TypeScript at runtime, so `request` here can be `null`, `{}`, or carry a
 * `kind` outside the three known ones. Without this guard that case fell
 * through the switch with no matching branch and returned `undefined` —
 * never a thrown error, but not a safe, structured rejection either. This
 * is the only change this validation phase made: a malformed request is
 * now always a clean `{ kind: "invalid", success: false, error }`, exactly
 * like every other rejection path in this file — still never anything
 * approaching executeQgCommand()/executeQgAction().
 */
export async function runClaudeLabRequest(request: ClaudeLabRequest): Promise<ClaudeLabResult> {
  if (!request || typeof request !== "object" || typeof (request as { kind?: unknown }).kind !== "string") {
    return { kind: "invalid", success: false, error: "Requisição inválida — formato não reconhecido." };
  }

  switch (request.kind) {
    case "query":
      return { kind: "query", ...(await runClaudeLabQuery({ command: request.command })) };
    case "action_candidates":
      return { kind: "action_candidates", ...(await runClaudeLabActionCandidates({ command: request.command })) };
    case "action_confirm":
      return { kind: "action_confirm", ...(await runClaudeLabActionConfirm(request)) };
    default:
      return { kind: "invalid", success: false, error: "Requisição inválida — kind não reconhecido." };
  }
}
