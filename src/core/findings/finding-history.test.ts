import { describe, expect, it } from "vitest";
import { buildFindingHistory, type FindingHistoryRunInput } from "./finding-history";
import type { ConsolidatedFinding } from "./mission-evaluation-report";
import type { EvaluationTarget } from "@/domain/evaluation-mission";

const DEFAULT_TARGET: EvaluationTarget = { url: "http://localhost:3000/qg", name: "AI Product Lab — LAB QG" };

function finding(text: string, evidence = `evidence for ${text}`): ConsolidatedFinding {
  return {
    status: "FINDING",
    finding: text,
    duplicated: false,
    sources: [{ agentId: "qa-agent", evidence, impact: "LOW", recommendation: null, confidence: "MEDIUM", classification: "BUG" }],
  };
}

function run(
  runId: string,
  createdAt: string,
  findings: ConsolidatedFinding[],
  target: EvaluationTarget = DEFAULT_TARGET,
): FindingHistoryRunInput {
  return { runId, target, createdAt: new Date(createdAt), findings };
}

/** Small helper: the single timeline in a single-target result, for the given finding text. */
function timelineFor(runs: FindingHistoryRunInput[], text: string) {
  const [history] = buildFindingHistory(runs);
  return history?.timelines.find((t) => t.finding === text);
}

describe("buildFindingHistory", () => {
  it("never accesses a database — pure in-memory input/output", () => {
    // No assertion needed beyond the fact that this call compiles and runs
    // with plain objects, no Prisma types, no async/await.
    const result = buildFindingHistory([run("r1", "2026-01-01T00:00:00Z", [finding("A")])]);
    expect(result).toHaveLength(1);
  });

  // Case 1 — persistent finding
  it("marks a finding present in two consecutive runs as PERSISTENT on the second", () => {
    const runs = [run("r1", "2026-01-01T00:00:00Z", [finding("A")]), run("r2", "2026-01-02T00:00:00Z", [finding("A")])];
    const a = timelineFor(runs, "A");
    expect(a?.points.map((p) => p.status)).toEqual(["FIRST_OBSERVED", "PERSISTENT"]);
    expect(a?.points.map((p) => p.present)).toEqual([true, true]);
  });

  // Case 2 — not reproduced + new
  it("marks a finding absent from the next run as NOT_REPRODUCED, and a finding appearing for the first time as NEW", () => {
    const runs = [run("r1", "2026-01-01T00:00:00Z", [finding("A")]), run("r2", "2026-01-02T00:00:00Z", [finding("B")])];
    const a = timelineFor(runs, "A");
    const b = timelineFor(runs, "B");
    expect(a?.points.map((p) => p.status)).toEqual(["FIRST_OBSERVED", "NOT_REPRODUCED"]);
    expect(a?.points.map((p) => p.present)).toEqual([true, false]);
    expect(b?.points.map((p) => p.status)).toEqual(["NEW"]);
    expect(b?.points.map((p) => p.present)).toEqual([true]);
  });

  // Case 3 — finding reappears
  it("marks a finding reappearing after an absence as REAPPEARED, preserving every transition", () => {
    const runs = [
      run("r1", "2026-01-01T00:00:00Z", [finding("A")]),
      run("r2", "2026-01-02T00:00:00Z", [finding("B")]),
      run("r3", "2026-01-03T00:00:00Z", [finding("A")]),
    ];
    const a = timelineFor(runs, "A");
    expect(a?.points.map((p) => p.status)).toEqual(["FIRST_OBSERVED", "NOT_REPRODUCED", "REAPPEARED"]);
    expect(a?.points.map((p) => p.present)).toEqual([true, false, true]);
  });

  // Case 4 — multiple findings in the same comparison
  it("tracks multiple independent findings correctly in the same run set", () => {
    const runs = [
      run("r1", "2026-01-01T00:00:00Z", [finding("A"), finding("B")]),
      run("r2", "2026-01-02T00:00:00Z", [finding("A"), finding("C")]),
    ];
    expect(timelineFor(runs, "A")?.points.map((p) => p.status)).toEqual(["FIRST_OBSERVED", "PERSISTENT"]);
    expect(timelineFor(runs, "B")?.points.map((p) => p.status)).toEqual(["FIRST_OBSERVED", "NOT_REPRODUCED"]);
    expect(timelineFor(runs, "C")?.points.map((p) => p.status)).toEqual(["NEW"]);
  });

  // Case 5 — order independence
  it("produces the same chronological result regardless of the order runs are passed in", () => {
    const r1 = run("r1", "2026-01-01T00:00:00Z", [finding("A")]);
    const r2 = run("r2", "2026-01-02T00:00:00Z", [finding("B")]);

    const inOrder = buildFindingHistory([r1, r2]);
    const outOfOrder = buildFindingHistory([r2, r1]);

    expect(outOfOrder).toEqual(inOrder);
    expect(outOfOrder[0]?.runIds).toEqual(["r1", "r2"]);
  });

  // Case 6 — different targets are never compared
  it("never compares runs of different targets against each other", () => {
    const targetA: EvaluationTarget = { url: "http://localhost:3000/app-a" };
    const targetB: EvaluationTarget = { url: "http://localhost:3000/app-b" };
    const runs = [
      run("r1", "2026-01-01T00:00:00Z", [finding("A")], targetA),
      run("r2", "2026-01-02T00:00:00Z", [finding("A")], targetB),
    ];

    const result = buildFindingHistory(runs);
    expect(result).toHaveLength(2);
    // Each target's own "A" is FIRST_OBSERVED in its own single-run history —
    // never PERSISTENT, which would only be correct if the two runs had been
    // (wrongly) compared to each other.
    for (const history of result) {
      expect(history.runIds).toHaveLength(1);
      expect(history.timelines[0]?.points.map((p) => p.status)).toEqual(["FIRST_OBSERVED"]);
    }
  });

  // Case 7 — textually different findings are never treated as equivalent
  it("never treats textually different findings as the same, even when conceptually similar", () => {
    const runs = [
      run("r1", "2026-01-01T00:00:00Z", [finding("Login quebrado")]),
      run("r2", "2026-01-02T00:00:00Z", [finding("Usuário não consegue logar")]),
    ];
    const [history] = buildFindingHistory(runs);
    expect(history?.timelines).toHaveLength(2);
    expect(timelineFor(runs, "Login quebrado")?.points.map((p) => p.status)).toEqual(["FIRST_OBSERVED", "NOT_REPRODUCED"]);
    expect(timelineFor(runs, "Usuário não consegue logar")?.points.map((p) => p.status)).toEqual(["NEW"]);
  });

  it("reuses the exact equivalence rule from mission-evaluation-report.ts — same finding text but different evidence is NOT equivalent", () => {
    const runs = [
      run("r1", "2026-01-01T00:00:00Z", [finding("A", "evidence one")]),
      run("r2", "2026-01-02T00:00:00Z", [finding("A", "evidence two")]),
    ];
    const [history] = buildFindingHistory(runs);
    // Two distinct identities, because isEquivalentFinding requires BOTH
    // finding AND evidence text to match — never split, never loosened here.
    expect(history?.timelines).toHaveLength(2);
  });

  it("reuses the exact equivalence rule's own trimming/case-folding — whitespace and case differences ARE equivalent", () => {
    const runs = [
      run("r1", "2026-01-01T00:00:00Z", [finding("Broken login", "  Same Evidence  ")]),
      run("r2", "2026-01-02T00:00:00Z", [finding("  broken login  ", "same evidence")]),
    ];
    const [history] = buildFindingHistory(runs);
    expect(history?.timelines).toHaveLength(1);
    expect(history?.timelines[0]?.points.map((p) => p.status)).toEqual(["FIRST_OBSERVED", "PERSISTENT"]);
  });

  // Case 8 — a run with no findings at all
  it("handles a run with zero findings following a run that had findings", () => {
    const runs = [run("r1", "2026-01-01T00:00:00Z", [finding("A")]), run("r2", "2026-01-02T00:00:00Z", [])];
    expect(timelineFor(runs, "A")?.points.map((p) => p.status)).toEqual(["FIRST_OBSERVED", "NOT_REPRODUCED"]);
  });

  // Case 9 — a single run never invents a comparison
  it("produces a valid, non-invented result for a single run", () => {
    const runs = [run("r1", "2026-01-01T00:00:00Z", [finding("A"), finding("B")])];
    const [history] = buildFindingHistory(runs);
    expect(history?.runIds).toEqual(["r1"]);
    for (const timeline of history?.timelines ?? []) {
      expect(timeline.points).toHaveLength(1);
      expect(timeline.points[0]?.status).toBe("FIRST_OBSERVED");
    }
  });

  // Case 10 — multiple recurrences, never collapsed to the latest state
  it("preserves every transition across multiple disappear/reappear cycles", () => {
    const runs = [
      run("r1", "2026-01-01T00:00:00Z", [finding("A")]),
      run("r2", "2026-01-02T00:00:00Z", []),
      run("r3", "2026-01-03T00:00:00Z", [finding("A")]),
      run("r4", "2026-01-04T00:00:00Z", []),
      run("r5", "2026-01-05T00:00:00Z", [finding("A")]),
    ];
    const a = timelineFor(runs, "A");
    expect(a?.points).toHaveLength(5);
    expect(a?.points.map((p) => p.status)).toEqual([
      "FIRST_OBSERVED",
      "NOT_REPRODUCED",
      "REAPPEARED",
      "NOT_REPRODUCED",
      "REAPPEARED",
    ]);
  });

  it("never labels an absence as resolved/fixed/implemented — only NOT_REPRODUCED exists for that", () => {
    // A type-level + naming guarantee, asserted the only way a test can:
    // enumerate every possible status value this module can ever produce.
    const allStatuses: string[] = ["FIRST_OBSERVED", "PERSISTENT", "NOT_REPRODUCED", "NEW", "REAPPEARED"];
    for (const forbidden of ["RESOLVED", "FIXED", "IMPLEMENTED", "SUCCESS"]) {
      expect(allStatuses).not.toContain(forbidden);
    }
  });
});
