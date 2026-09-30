import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { countAgentExecutions } from "./agents";

// Real integration test against the local dev Postgres — proving
// countAgentExecutions actually reflects real AgentExecution rows, since
// it's now the Dashboard's own source of truth for "has an agent run yet"
// (see src/app/page.tsx).
describe("countAgentExecutions (integration)", () => {
  const projectIds: string[] = [];
  const executionIds: string[] = [];

  afterAll(async () => {
    if (executionIds.length) await db.agentExecution.deleteMany({ where: { id: { in: executionIds } } });
    if (projectIds.length) await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.$disconnect();
  });

  it("is 0 for a project with no AgentExecution rows", async () => {
    const organization = await getDefaultOrganization();
    const project = await db.project.create({
      data: { organizationId: organization.id, name: `countAgentExecutions empty test ${Date.now()}` },
    });
    projectIds.push(project.id);

    expect(await countAgentExecutions([project.id])).toBe(0);
  });

  it("is 0 for an empty project id list, without querying the database", async () => {
    expect(await countAgentExecutions([])).toBe(0);
  });

  it("reflects real AgentExecution rows once they exist", async () => {
    const organization = await getDefaultOrganization();
    const project = await db.project.create({
      data: { organizationId: organization.id, name: `countAgentExecutions real test ${Date.now()}` },
    });
    projectIds.push(project.id);

    const agent = await db.agent.findFirst({ where: { slug: "qa-agent" } });
    if (!agent) throw new Error('Seed agent "qa-agent" not found — run the agent sync first.');

    const execution = await db.agentExecution.create({
      data: {
        projectId: project.id,
        agentId: agent.id,
        task: "countAgentExecutions test task",
        status: "SUCCESS",
        input: {},
      },
    });
    executionIds.push(execution.id);

    expect(await countAgentExecutions([project.id])).toBe(1);
  });
});
