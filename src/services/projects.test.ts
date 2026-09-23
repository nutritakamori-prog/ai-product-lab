import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createProject, listProjects } from "./projects";

// Real integration test against the local dev Postgres (see docs/DEVELOPMENT.md
// for how to start it) — proving the create → persist → read-back path actually
// works, not just that the code compiles.
describe("projects service (integration)", () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    if (createdIds.length) {
      await db.auditLog.deleteMany({ where: { entityId: { in: createdIds } } });
      await db.project.deleteMany({ where: { id: { in: createdIds } } });
    }
    await db.$disconnect();
  });

  it("creates a project and it shows up in listProjects", async () => {
    const unique = `Test project ${Date.now()}`;

    const created = await createProject({ name: unique, mode: "INTERNAL" });
    createdIds.push(created.id);

    expect(created.name).toBe(unique);
    expect(created.mode).toBe("INTERNAL");

    const projects = await listProjects();
    expect(projects.some((p) => p.id === created.id)).toBe(true);
  });

  it("records an audit log entry for the creation", async () => {
    const unique = `Test project ${Date.now()}-audit`;
    const created = await createProject({ name: unique });
    createdIds.push(created.id);

    const log = await db.auditLog.findFirst({
      where: { entityType: "Project", entityId: created.id, action: "project.created" },
    });

    expect(log).not.toBeNull();
  });
});
