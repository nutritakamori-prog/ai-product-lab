import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { createImplementation } from "./implementations";
import { createValidation, getValidation, listValidationsForImplementation } from "./validations";

describe("validations (integration)", () => {
  const projectIds: string[] = [];
  const missionRunIds: string[] = [];

  afterAll(async () => {
    if (missionRunIds.length) await db.evaluationMissionRun.deleteMany({ where: { id: { in: missionRunIds } } });
    if (projectIds.length) await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.$disconnect();
  });

  async function makeProjectAndMissionRun(name: string) {
    const organization = await getDefaultOrganization();
    const project = await db.project.create({ data: { organizationId: organization.id, name: `${name} ${Date.now()}-${Math.random()}` } });
    projectIds.push(project.id);

    const missionRun = await db.evaluationMissionRun.create({
      data: {
        projectId: project.id,
        status: "COMPLETED",
        input: { target: { url: "http://localhost:3000/qg" }, objective: "test", task: "test", requestedAgents: ["qa-agent"] },
      },
    });
    missionRunIds.push(missionRun.id);
    return { project, missionRun };
  }

  async function makeApprovedImplementation(name: string) {
    const { project, missionRun } = await makeProjectAndMissionRun(name);
    const recommendation = await db.recommendation.create({
      data: {
        missionRunId: missionRun.id,
        findingIndex: 0,
        title: "Finding",
        summary: "Summary",
        whyItMatters: "Because",
        recommendedAction: "Do something",
        status: "APPROVED",
      },
    });
    const implementation = await createImplementation(recommendation.id);
    return { project, missionRun, recommendation, implementation };
  }

  // Case 6
  it("rejects a Validation whose Implementation doesn't exist", async () => {
    await expect(createValidation({ implementationId: "does-not-exist", status: "PASSED" })).rejects.toThrow(/does not exist/);
  });

  // Case 7
  it("keeps the Validation correctly linked to its Implementation", async () => {
    const { implementation } = await makeApprovedImplementation("validations linked");
    const validation = await createValidation({ implementationId: implementation.id, status: "PASSED", notes: "Confirmed fixed" });

    expect(validation.implementationId).toBe(implementation.id);
    const fetched = await getValidation(validation.id);
    expect(fetched?.implementationId).toBe(implementation.id);
    expect(fetched?.notes).toBe("Confirmed fixed");
  });

  // Case 8
  it("references the real retest EvaluationMissionRun when one is given", async () => {
    const { project, implementation } = await makeApprovedImplementation("validations retest mission");
    const retestRun = await db.evaluationMissionRun.create({
      data: {
        projectId: project.id,
        status: "COMPLETED",
        input: { target: { url: "http://localhost:3000/qg" }, objective: "retest", task: "retest", requestedAgents: ["qa-agent"] },
      },
    });
    missionRunIds.push(retestRun.id);

    const validation = await createValidation({ implementationId: implementation.id, status: "PASSED", retestMissionRunId: retestRun.id });
    expect(validation.retestMissionRunId).toBe(retestRun.id);
    expect(validation.retestTestRunId).toBeNull();
  });

  it("rejects a retest EvaluationMissionRun that doesn't exist", async () => {
    const { implementation } = await makeApprovedImplementation("validations invalid retest");
    await expect(
      createValidation({ implementationId: implementation.id, status: "PASSED", retestMissionRunId: "does-not-exist" }),
    ).rejects.toThrow(/does not exist/);
  });

  it("rejects a Validation naming both retest sources at once", async () => {
    const { implementation } = await makeApprovedImplementation("validations both sources");
    await expect(
      createValidation({
        implementationId: implementation.id,
        status: "PASSED",
        retestMissionRunId: "some-id",
        retestTestRunId: "some-other-id",
      }),
    ).rejects.toThrow(/at most one retest source/);
  });

  // Case 9 — project isolation, at the retest-reference boundary
  it("rejects a retest EvaluationMissionRun that belongs to a different project than the Implementation's own Recommendation", async () => {
    const { implementation } = await makeApprovedImplementation("validations isolation A");
    const { project: otherProject } = await makeProjectAndMissionRun("validations isolation B");
    const crossProjectRun = await db.evaluationMissionRun.create({
      data: {
        projectId: otherProject.id,
        status: "COMPLETED",
        input: { target: { url: "http://localhost:3000/qg" }, objective: "retest", task: "retest", requestedAgents: ["qa-agent"] },
      },
    });
    missionRunIds.push(crossProjectRun.id);

    await expect(
      createValidation({ implementationId: implementation.id, status: "PASSED", retestMissionRunId: crossProjectRun.id }),
    ).rejects.toThrow(/different project/);
  });

  // Case 11
  it("keeps an Implementation with no Validation identifiable as such, not an error", async () => {
    const { implementation } = await makeApprovedImplementation("validations none-yet");
    expect(await listValidationsForImplementation(implementation.id)).toEqual([]);
  });

  it("keeps every Validation for an Implementation, in chronological order, never collapsed to the latest", async () => {
    const { implementation } = await makeApprovedImplementation("validations multiple");
    const first = await createValidation({ implementationId: implementation.id, status: "INCONCLUSIVE" });
    const second = await createValidation({ implementationId: implementation.id, status: "PASSED" });

    const validations = await listValidationsForImplementation(implementation.id);
    expect(validations.map((v) => v.id)).toEqual([first.id, second.id]);
    expect(validations.map((v) => v.status)).toEqual(["INCONCLUSIVE", "PASSED"]);
  });
});
