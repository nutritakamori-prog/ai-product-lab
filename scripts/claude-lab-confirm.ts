import "dotenv/config";
import { runClaudeLabActionCandidates, runClaudeLabActionConfirm } from "../src/services/claude-lab-adapter";

/**
 * FASE 15E — closes the operational gap found in Fase 15D: a token minted
 * by `npm run lab:bridge -- '{"kind":"action_candidates",...}'` lives in
 * one Node process's in-memory Map (qg-action-confirmation.ts, by design —
 * see Fase 15B-2) and is gone the moment that process exits, so a second,
 * independent `npm run lab:bridge -- '{"kind":"action_confirm",...}'`
 * invocation can never find it. That is fail-closed and correct — it must
 * never become fail-open.
 *
 * The answer this phase reached is: no persistence is needed. The human
 * confirmation step was never going to happen *inside* a running process
 * anyway — it happens in the conversation between the user and Claude
 * Code, between one tool call and the next. So the mint-and-consume pair
 * only ever needs to share a process with EACH OTHER, not with the
 * earlier read-only `action_candidates` call that showed the candidate to
 * the human in the first place.
 *
 * This script is invoked only *after* that human confirmation has already
 * happened in conversation, naming an action + targetId already approved.
 * In one process, it:
 *   1. calls the real runClaudeLabActionCandidates() again, for a fresh,
 *      live list (defends against staleness — if the target was already
 *      actioned or disappeared between the chat turn and this call, it
 *      simply won't be in the list anymore);
 *   2. finds the exact candidate the human approved, by targetId;
 *   3. calls the real runClaudeLabActionConfirm() with the token that
 *      candidate just received, in the same process that minted it.
 *
 * No new token store, no token persisted to disk/db, no `confirmed: true`
 * trusted from the caller, no bypass of consumeActionConfirmation(), and
 * no direct call to executeQgAction(): this is still exactly
 * action_candidates -> real token -> action_confirm -> consumeActionConfirmation()
 * -> executeQgAction(), just kept inside one process instead of two.
 *
 *   npm run lab:confirm -- '{"command":"APPROVE_RECOMMENDATION","targetId":"..."}'
 */
async function main() {
  const raw = process.argv[2];
  if (!raw) {
    console.error('Uso: npm run lab:confirm -- \'{"command":"APPROVE_RECOMMENDATION","targetId":"..."}\'');
    process.exitCode = 1;
    return;
  }

  let request: { command?: unknown; targetId?: unknown };
  try {
    request = JSON.parse(raw) as { command?: unknown; targetId?: unknown };
  } catch {
    console.log(JSON.stringify({ success: false, error: "JSON inválido na requisição." }));
    process.exitCode = 1;
    return;
  }

  const command = typeof request.command === "string" ? request.command : "";
  const targetId = typeof request.targetId === "string" ? request.targetId : "";
  if (!command || !targetId) {
    console.log(JSON.stringify({ success: false, error: "command e targetId são obrigatórios." }));
    process.exitCode = 1;
    return;
  }

  const candidates = await runClaudeLabActionCandidates({ command });
  if (!candidates.success) {
    console.log(JSON.stringify(candidates, null, 2));
    process.exitCode = 1;
    return;
  }

  const candidate = candidates.candidates.find((c) => c.targetId === targetId);
  if (!candidate) {
    console.log(JSON.stringify({ success: false, command: candidates.command, error: "Candidato não encontrado — pode já ter sido tratado, ou o targetId não corresponde a nenhum candidato real atual." }, null, 2));
    process.exitCode = 1;
    return;
  }

  const result = await runClaudeLabActionConfirm({ command, targetId, token: candidate.token });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error("Confirm falhou:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { db } = await import("../src/lib/db");
    await db.$disconnect();
  });
