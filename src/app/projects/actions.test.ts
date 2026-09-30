import { afterAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createProjectAction, type CreateProjectActionState } from "./actions";

// revalidatePath() requires a real Next.js request/render context (it
// throws "static generation store missing" otherwise) — every other tested
// action in this codebase (e.g. runEvaluationMissionAction) simply never
// calls it. createProjectAction does, so it needs this same no-op mock —
// hoisted by Vitest above the import above — purely to make the action
// callable outside a real request; it has no effect on the actual app.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const INITIAL_STATE: CreateProjectActionState = { createdName: null, error: null };

function form(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

// Real integration test against the local dev Postgres — proves the
// useActionState-driven shape actually reports success/error, since that's
// the exact gap the "no confirmation after creating a project" finding
// identified (a plain fire-and-forget action had no result to show at all).
describe("createProjectAction (integration)", () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    if (createdIds.length) await db.project.deleteMany({ where: { id: { in: createdIds } } });
    await db.$disconnect();
  });

  it("returns the created project's name on success, and it is actually persisted", async () => {
    const unique = `Test project ${Date.now()}`;
    const state = await createProjectAction(INITIAL_STATE, form({ name: unique, description: "", mode: "HYBRID" }));

    expect(state.error).toBeNull();
    expect(state.createdName).toBe(unique);

    const created = await db.project.findFirst({ where: { name: unique } });
    expect(created).not.toBeNull();
    if (created) createdIds.push(created.id);
  });

  it("returns an error, without throwing, for an invalid submission (empty name)", async () => {
    const state = await createProjectAction(INITIAL_STATE, form({ name: "", description: "", mode: "HYBRID" }));

    expect(state.createdName).toBeNull();
    expect(state.error).toBeTruthy();
  });
});
