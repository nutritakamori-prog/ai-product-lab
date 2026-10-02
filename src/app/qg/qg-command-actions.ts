"use server";

import { revalidatePath } from "next/cache";
import { matchCommand } from "@/core/qg-command-router/qg-command-router";
import { executeQgCommand, type QgCommandResult } from "@/services/qg-command-router";
import { executeQgAction } from "@/services/qg-action-executor";

/**
 * FASE 11/12 — QG Runtime. The bridge between the QG's client-side Command
 * Center UI and the real LAB services. Two Server Actions, deliberately
 * kept separate:
 *
 * - runQgCommandAction: read-only, QG -> Command Router (matchCommand,
 *   pure) -> existing LAB services (executeQgCommand) -> result -> QG.
 *   Never touches the database directly, never creates/modifies/removes
 *   anything.
 * - confirmQgActionAction: the ONLY path that can change state, and only
 *   ever called after the UI has shown the user exactly what will change
 *   and the user has explicitly clicked Confirmar (FASE 12) — never from
 *   free-text alone, never automatically.
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

export type QgActionConfirmResult = { status: "OK"; message: string } | { status: "ERROR"; message: string };

/**
 * `action` is typed loosely (string) on purpose: a Server Action is a real
 * network endpoint, callable with any string regardless of what the
 * client's own TypeScript types say — executeQgAction() re-validates it
 * against the real QgActionId allow-list at runtime before doing anything.
 */
export async function confirmQgActionAction(action: string, targetId: string): Promise<QgActionConfirmResult> {
  try {
    const outcome = await executeQgAction(action, targetId);
    revalidatePath("/qg");
    return { status: "OK", message: outcome.message };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Não foi possível executar esta ação agora.";
    return { status: "ERROR", message };
  }
}
