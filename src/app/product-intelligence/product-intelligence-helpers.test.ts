import { describe, expect, it } from "vitest";
import { headEmptyMessage, countRecommendationsByRun } from "./product-intelligence-helpers";

describe("headEmptyMessage", () => {
  it("never claims no evaluation has run when a completed one actually exists", () => {
    const message = headEmptyMessage({ status: "COMPLETED" });
    expect(message).not.toMatch(/execute uma Evaluation Mission/i);
    expect(message).not.toMatch(/nenhuma avaliação/i);
  });

  it("says so plainly when no run exists at all", () => {
    expect(headEmptyMessage(null)).toMatch(/nenhuma avaliação/i);
  });

  it("explains an unfinished/failed run has no report to synthesize", () => {
    expect(headEmptyMessage({ status: "RUNNING" })).toMatch(/não produziu um relatório/i);
    expect(headEmptyMessage({ status: "FAILED" })).toMatch(/não produziu um relatório/i);
  });
});

describe("countRecommendationsByRun", () => {
  it("groups recommendations by their own missionRunId, exactly as History displays them per evaluation", () => {
    const counts = countRecommendationsByRun([
      { missionRunId: "run-a", status: "PENDING" },
      { missionRunId: "run-a", status: "PENDING" },
      { missionRunId: "run-a", status: "APPROVED" },
      { missionRunId: "run-b", status: "IGNORED" },
    ]);

    expect(counts.get("run-a")).toEqual({ pending: 2, approved: 1, ignored: 0 });
    expect(counts.get("run-b")).toEqual({ pending: 0, approved: 0, ignored: 1 });
  });

  it("has no entry for a run with no recommendations at all (e.g. a FAILED run, or one with no findings)", () => {
    const counts = countRecommendationsByRun([{ missionRunId: "run-a", status: "PENDING" }]);
    expect(counts.get("run-without-recommendations")).toBeUndefined();
  });
});
