import { db } from "@/lib/db";

/**
 * Read-only for now. The Agent registry is populated in Phase 5 — this only
 * exists so the Agents page can show the real (currently empty) state
 * instead of a mockup.
 */
export async function listAgents() {
  return db.agent.findMany({ orderBy: { name: "asc" } });
}
