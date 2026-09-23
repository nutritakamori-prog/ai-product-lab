import { db } from "@/lib/db";

/**
 * The only place that reads the Agent table for the purpose of looking one
 * up to run. Adding a new agent means inserting a row — nothing here changes.
 */
export const AgentRegistry = {
  getBySlug(slug: string) {
    return db.agent.findUnique({ where: { slug } });
  },
  listEnabled() {
    return db.agent.findMany({ where: { enabled: true }, orderBy: { name: "asc" } });
  },
  list() {
    return db.agent.findMany({ orderBy: { name: "asc" } });
  },
};
