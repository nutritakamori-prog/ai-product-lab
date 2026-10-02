import { randomUUID } from "node:crypto";
import { isQgActionId, type QgActionId } from "@/core/qg-command-router/qg-command-router";

/**
 * FASE 15B-2 — a real server-side barrier between "a candidate the UI (or
 * a future caller) identified" and executeQgAction() actually running.
 * Before this, the only thing standing between "selected a candidate" and
 * "mutation executed" was client-side React state — a `confirmed: true`
 * sent in the same request would have been no protection at all, since
 * any caller could just send it directly. A confirmation must now be
 * minted here first (createActionConfirmation), and the token it returns
 * is the only thing that can unlock executeQgAction() (via
 * consumeActionConfirmation) — bound to the exact action and targetId it
 * was created for, single-use, and short-lived.
 *
 * In-memory by design — no new table, no new provider, the smallest
 * mechanism that is still a real barrier rather than a convenience. The
 * one accepted trade-off: on Vercel's serverless runtime this Map lives
 * in one function instance and isn't guaranteed to survive a cold start
 * or being served by a different instance than the one that issued the
 * token. The failure mode is always safe — a confirmation whose instance
 * is gone simply doesn't validate, so confirmQgActionAction rejects it
 * and no mutation runs. It can never fail open, only occasionally ask for
 * a fresh confirmation.
 */

const CONFIRMATION_TTL_MS = 2 * 60 * 1000;

interface PendingConfirmation {
  action: QgActionId;
  targetId: string;
  expiresAt: number;
  used: boolean;
}

const pendingConfirmations = new Map<string, PendingConfirmation>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [token, confirmation] of pendingConfirmations) {
    if (confirmation.expiresAt <= now) pendingConfirmations.delete(token);
  }
}

export interface ActionConfirmation {
  token: string;
  expiresAt: number;
}

/**
 * Mints a new, single-use confirmation for exactly this action/targetId
 * pair. Throws if `action` isn't one of the four real QgActionId values —
 * never issues a token for something that was never a valid action to
 * begin with.
 */
export function createActionConfirmation(action: string, targetId: string): ActionConfirmation {
  if (!isQgActionId(action)) {
    throw new Error("Ação desconhecida — nenhuma confirmação foi criada.");
  }
  pruneExpired();

  const token = randomUUID();
  const expiresAt = Date.now() + CONFIRMATION_TTL_MS;
  pendingConfirmations.set(token, { action, targetId, expiresAt, used: false });
  return { token, expiresAt };
}

export type ConfirmationCheck = { valid: true } | { valid: false; reason: string };

/**
 * Validates a token against the exact action/targetId it must match, and
 * consumes it (marks it used, so it can never validate again) only when
 * that match succeeds. A mismatched action/targetId against a real token
 * is rejected without burning the token — a caller that made a mistake
 * can still confirm the right thing afterward — but neither case ever
 * leaks *why* in a way that helps guess a real token (the three rejection
 * reasons below are deliberately similar in shape).
 */
export function consumeActionConfirmation(token: string, action: string, targetId: string): ConfirmationCheck {
  const confirmation = pendingConfirmations.get(token);

  if (!confirmation) {
    return { valid: false, reason: "Confirmação inválida ou já utilizada." };
  }
  if (confirmation.used) {
    return { valid: false, reason: "Confirmação já utilizada." };
  }
  if (confirmation.expiresAt <= Date.now()) {
    pendingConfirmations.delete(token);
    return { valid: false, reason: "Confirmação expirada." };
  }
  if (confirmation.action !== action || confirmation.targetId !== targetId) {
    return { valid: false, reason: "Confirmação não corresponde a esta ação ou alvo." };
  }

  confirmation.used = true;
  return { valid: true };
}
