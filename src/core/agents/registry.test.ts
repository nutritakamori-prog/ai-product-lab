import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AgentRegistry } from "./registry";

// Real integration test against local Postgres — proves adding a row is all
// it takes for the registry to see a new agent, with no code changes.
describe("AgentRegistry (integration)", () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    if (createdIds.length) {
      await db.agent.deleteMany({ where: { id: { in: createdIds } } });
    }
    await db.$disconnect();
  });

  async function createTestAgent(overrides: Partial<Parameters<typeof db.agent.create>[0]["data"]> = {}) {
    const agent = await db.agent.create({
      data: {
        slug: `test-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: "Test Agent",
        type: "QA",
        description: "A throwaway agent for registry tests.",
        responsibility: "Nothing real.",
        whenNotToCall: "Never — this is a test fixture.",
        capabilities: [],
        systemPrompt: "You are a test agent.",
        inputSchema: {},
        outputSchema: {},
        tokenBudget: 1000,
        enabled: false,
        allowedTools: [],
        supportedTaskTypes: [],
        ...overrides,
      },
    });
    createdIds.push(agent.id);
    return agent;
  }

  it("finds an agent by slug after it's inserted", async () => {
    const agent = await createTestAgent();
    const found = await AgentRegistry.getBySlug(agent.slug);
    expect(found?.id).toBe(agent.id);
  });

  it("returns null for a slug that doesn't exist", async () => {
    const found = await AgentRegistry.getBySlug("does-not-exist-xyz");
    expect(found).toBeNull();
  });

  it("listEnabled only returns enabled agents", async () => {
    const enabled = await createTestAgent({ enabled: true });
    const disabled = await createTestAgent({ enabled: false });

    const list = await AgentRegistry.listEnabled();
    const ids = list.map((a) => a.id);

    expect(ids).toContain(enabled.id);
    expect(ids).not.toContain(disabled.id);
  });

  it("list returns every agent regardless of enabled state", async () => {
    const agent = await createTestAgent({ enabled: false });
    const list = await AgentRegistry.list();
    expect(list.map((a) => a.id)).toContain(agent.id);
  });
});
