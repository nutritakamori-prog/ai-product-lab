import { db } from "@/lib/db";
import { AGENT_DEFINITIONS } from "@agents/index";
import { agentDefinitionSchema, type AgentDefinition } from "@agents/system/agent-protocol";

/**
 * An agent definition (behavior, from the file) merged with its current
 * operational state (tokenBudget/modelTier/enabled, from the Agent table —
 * may diverge from the file's defaults once an operator changes them).
 * `dbId` is the Agent row's primary key, needed by the Runtime to write
 * AgentExecution.agentId (a real foreign key, unlike the human-readable
 * `id` slug).
 */
export interface ResolvedAgent extends AgentDefinition {
  dbId: string;
}

function loadDefinition(slug: string): AgentDefinition | null {
  const found = AGENT_DEFINITIONS.find((definition) => definition.id === slug);
  if (!found) return null;
  // Re-validate defensively — the file already validates itself at import
  // time (see agents/experience/new-user.ts), but the Registry shouldn't
  // trust that blindly for every possible future agent file.
  return agentDefinitionSchema.parse(found);
}

/**
 * Finds the Agent row for a definition, creating it (seeded from the
 * file's own tokenBudget/modelTier/enabled defaults) the first time this
 * agent is discovered. Never overwrites an existing row — once created,
 * the database is the operational source of truth, not the file.
 */
async function resolveOperationalState(definition: AgentDefinition) {
  const existing = await db.agent.findUnique({ where: { slug: definition.id } });
  if (existing) return existing;

  return db.agent.create({
    data: {
      slug: definition.id,
      category: definition.category,
      modelTier: definition.modelTier,
      tokenBudget: definition.tokenBudget,
      enabled: definition.enabled,
    },
  });
}

function toResolvedAgent(
  definition: AgentDefinition,
  row: { id: string; modelTier: AgentDefinition["modelTier"]; tokenBudget: number; enabled: boolean },
): ResolvedAgent {
  return {
    ...definition,
    modelTier: row.modelTier,
    tokenBudget: row.tokenBudget,
    enabled: row.enabled,
    dbId: row.id,
  };
}

export const AgentRegistry = {
  /** Every agent id known to the library, regardless of enabled state. */
  discoverSlugs(): string[] {
    return AGENT_DEFINITIONS.map((definition) => definition.id);
  },

  /** Loads and validates one agent's file definition — no database access. */
  loadDefinition(slug: string): AgentDefinition | null {
    return loadDefinition(slug);
  },

  /** The full picture the Runtime needs to execute this agent, or null if unknown. */
  async getBySlug(slug: string): Promise<ResolvedAgent | null> {
    const definition = loadDefinition(slug);
    if (!definition) return null;
    const row = await resolveOperationalState(definition);
    return toResolvedAgent(definition, row);
  },

  async listEnabled(): Promise<ResolvedAgent[]> {
    const all = await AgentRegistry.list();
    return all.filter((agent) => agent.enabled);
  },

  async list(): Promise<ResolvedAgent[]> {
    const resolved: ResolvedAgent[] = [];
    for (const definition of AGENT_DEFINITIONS) {
      const row = await resolveOperationalState(definition);
      resolved.push(toResolvedAgent(definition, row));
    }
    return resolved.sort((a, b) => a.name.localeCompare(b.name));
  },
};
