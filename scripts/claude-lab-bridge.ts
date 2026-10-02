import "dotenv/config";
import { runClaudeLabRequest, type ClaudeLabRequest } from "../src/services/claude-lab-adapter";

/**
 * FASE 15C — the minimal local bridge that lets Claude Code (operating on
 * this repository) act as a real consumer of the Claude ↔ LAB contract,
 * without any HTTP endpoint, MCP server, or Anthropic API connection.
 * Mirrors the exact pattern scripts/run-test-round.ts already uses: a tsx
 * script, invoked via `npm run`, importing a server-only src/ module
 * directly and disconnecting Prisma when done.
 *
 * The single CLI argument IS a real ClaudeLabRequest (JSON) — no second,
 * parallel request format is defined here. It is parsed and passed
 * straight into runClaudeLabRequest(), the same function any future real
 * integration would call.
 *
 *   npm run lab:bridge -- '{"kind":"query","command":"GET_LAST_CYCLE"}'
 *
 * Prints the real ClaudeLabResult as JSON on stdout. This script never
 * decides to confirm a mutation on its own: kind: "action_confirm" still
 * requires a real token obtained from a prior kind: "action_candidates"
 * call, validated server-side exactly as it already is for the QG's own
 * Command Center UI. Mutation confirmation is a decision for whoever
 * invokes this script with that exact request — not something this file
 * automates.
 */
async function main() {
  const raw = process.argv[2];
  if (!raw) {
    console.error('Uso: npm run lab:bridge -- \'{"kind":"query","command":"GET_LAST_CYCLE"}\'');
    process.exitCode = 1;
    return;
  }

  let request: ClaudeLabRequest;
  try {
    request = JSON.parse(raw) as ClaudeLabRequest;
  } catch {
    console.log(JSON.stringify({ success: false, error: "JSON inválido na requisição." }));
    process.exitCode = 1;
    return;
  }

  const result = await runClaudeLabRequest(request);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error("Bridge falhou:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { db } = await import("../src/lib/db");
    await db.$disconnect();
  });
