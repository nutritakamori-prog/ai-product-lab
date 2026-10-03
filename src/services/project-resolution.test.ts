import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createProject } from "./projects";
import { resolveProjectReference } from "./project-resolution";

describe("project-resolution (integration)", () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    if (createdIds.length) {
      await db.auditLog.deleteMany({ where: { entityId: { in: createdIds } } });
      await db.project.deleteMany({ where: { id: { in: createdIds } } });
    }
    await db.$disconnect();
  });

  it("resolves a clear, unambiguous reference to a real project", async () => {
    const unique = `Scheduler App ${Date.now()}`;
    const created = await createProject({ name: unique });
    createdIds.push(created.id);

    const result = await resolveProjectReference(`Analisa o ${unique}`);
    expect(result.status).toBe("RESOLVED");
    if (result.status === "RESOLVED") expect(result.project.id).toBe(created.id);
  });

  it("reports AMBIGUOUS, never guesses, when two real projects share the same reference word", async () => {
    const stamp = Date.now();
    const a = await createProject({ name: `Agenda App ${stamp}` });
    const b = await createProject({ name: `Agenda Web ${stamp}` });
    createdIds.push(a.id, b.id);

    const result = await resolveProjectReference(`analisa meu sistema de agenda ${stamp}`);
    expect(result.status).toBe("AMBIGUOUS");
    if (result.status === "AMBIGUOUS") {
      expect(result.candidates.map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
    }
  });

  it("reports NOT_FOUND with the real existing projects, never fabricates one", async () => {
    const created = await createProject({ name: `Zylaphone Tracker ${Date.now()}` });
    createdIds.push(created.id);

    const result = await resolveProjectReference("analisa o sistema de recursos humanos");
    expect(result.status).toBe("NOT_FOUND");
    if (result.status === "NOT_FOUND") {
      expect(result.existing.some((p) => p.id === created.id)).toBe(true);
    }
  });
});
