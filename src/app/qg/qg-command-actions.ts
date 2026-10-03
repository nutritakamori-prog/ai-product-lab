"use server";

import { revalidatePath } from "next/cache";
import { matchCommand } from "@/core/qg-command-router/qg-command-router";
import { executeQgCommand, type QgCommandResult } from "@/services/qg-command-router";
import { executeQgAction } from "@/services/qg-action-executor";
import { createActionConfirmation, consumeActionConfirmation } from "@/services/qg-action-confirmation";
import { interpretBrainMessage, type BrainState } from "@/services/operational-brain";

/**
 * FASE 11/12 — QG Runtime. The bridge between the QG's client-side Command
 * Center UI and the real LAB services. Three Server Actions, deliberately
 * kept separate:
 *
 * - runQgCommandAction: read-only, QG -> Command Router (matchCommand,
 *   pure) -> existing LAB services (executeQgCommand) -> result -> QG.
 *   Never touches the database directly, never creates/modifies/removes
 *   anything.
 * - requestQgActionConfirmationAction (FASE 15B-2): mints the one token
 *   that can ever unlock confirmQgActionAction below, bound to this exact
 *   action/targetId. Called the moment a candidate is selected — before
 *   that round-trip returns, no token exists anywhere for this attempt.
 * - confirmQgActionAction: the ONLY path that can change state. It no
 *   longer trusts "the UI already confirmed this" as a convention — it
 *   now requires the real token requestQgActionConfirmationAction issued,
 *   checked server-side (src/services/qg-action-confirmation.ts) before
 *   executeQgAction() is ever called. Never reachable from free-text
 *   alone, never automatically.
 *
 * A thrown error is deliberately never re-thrown to the client as a raw
 * exception: the UI must never see a stack trace, only a short, clean
 * message. The services this file calls (10B.3) already throw safe,
 * human-readable prose (e.g. "Recommendation ... is PENDING, not
 * APPROVED...") — passed through as-is; anything else falls back to a
 * generic message rather than leaking internals.
 */
export type QgCommandActionResult =
  | { status: "UNKNOWN_COMMAND"; input: string }
  | { status: "ERROR"; message: string }
  | { status: "OK"; result: QgCommandResult };

export async function runQgCommandAction(input: string): Promise<QgCommandActionResult> {
  const commandId = matchCommand(input);
  if (!commandId) {
    return { status: "UNKNOWN_COMMAND", input };
  }

  try {
    const result = await executeQgCommand(commandId);
    return { status: "OK", result };
  } catch {
    return { status: "ERROR", message: "Não foi possível consultar os dados do LAB agora." };
  }
}

/**
 * Noturno — Operational Brain. Called by the client only when
 * runQgCommandAction above already returned UNKNOWN_COMMAND (an exact known
 * phrase is still always resolved by the real, unmodified Command Router
 * first — this is the fallback layer, not a replacement). Never touches
 * `executeQgAction`/the confirmation token flow directly: when the Brain
 * decides a recommendation is ready to become an Implementation Task, it
 * returns the exact same ACTION_CANDIDATES shape the Command Router already
 * produces, so the existing confirm UI (and its real human-authorization
 * requirement) handles it unchanged.
 */
export type QgBrainActionResult = { status: "OK"; reply: Awaited<ReturnType<typeof interpretBrainMessage>> } | { status: "ERROR"; message: string };

export async function runQgBrainMessageAction(message: string, state: BrainState): Promise<QgBrainActionResult> {
  try {
    const result = await interpretBrainMessage(message, state);
    return { status: "OK", reply: result };
  } catch {
    return { status: "ERROR", message: "Não foi possível processar essa mensagem agora." };
  }
}

export type QgActionConfirmationRequestResult = { status: "OK"; token: string; expiresAt: number } | { status: "ERROR"; message: string };

/**
 * FASE 15B-2. Called the moment a candidate is selected in the UI (or by
 * any future caller identifying a candidate) — mints the one token that
 * can later unlock confirmQgActionAction for this exact action/targetId.
 * `action` is loosely typed (string) for the same reason as below:
 * createActionConfirmation() re-validates it against the real QgActionId
 * allow-list before issuing anything.
 */
export async function requestQgActionConfirmationAction(action: string, targetId: string): Promise<QgActionConfirmationRequestResult> {
  try {
    const confirmation = createActionConfirmation(action, targetId);
    return { status: "OK", token: confirmation.token, expiresAt: confirmation.expiresAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Não foi possível criar a confirmação agora.";
    return { status: "ERROR", message };
  }
}

export type QgActionConfirmResult = { status: "OK"; message: string } | { status: "ERROR"; message: string };

/**
 * `action` is typed loosely (string) on purpose: a Server Action is a real
 * network endpoint, callable with any string regardless of what the
 * client's own TypeScript types say — executeQgAction() re-validates it
 * against the real QgActionId allow-list at runtime before doing anything.
 *
 * FASE 15B-2: `token` must be a real, unexpired, unused confirmation
 * minted by requestQgActionConfirmationAction for this exact
 * action/targetId — checked here, server-side, before executeQgAction()
 * is ever called. A missing, wrong, expired, or already-used token never
 * reaches executeQgAction() at all.
 */
export async function confirmQgActionAction(action: string, targetId: string, token: string): Promise<QgActionConfirmResult> {
  const check = consumeActionConfirmation(token, action, targetId);
  if (!check.valid) {
    return { status: "ERROR", message: check.reason };
  }

  try {
    const outcome = await executeQgAction(action, targetId);
    revalidatePath("/qg");
    return { status: "OK", message: outcome.message };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Não foi possível executar esta ação agora.";
    return { status: "ERROR", message };
  }
}
