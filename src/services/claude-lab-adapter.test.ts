import { afterEach, describe, expect, it, vi } from "vitest";
import type { QgCommandResult, RecommendationCandidate, ImplementationCandidate, ValidationCandidate } from "@/services/qg-command-router";
import type { QgActionId } from "@/core/qg-command-router/qg-command-router";

/**
 * FASE 15B-1/15B-3 — unit tests for the adapter's OWN logic only (the
 * allow-list gates, the pass-through, the confirmation-token wiring, and
 * error sanitization). The underlying services (executeQgCommand,
 * executeQgAction) are already exhaustively covered by their own suites
 * (10B.1-10E, qg-command-router.test.ts, qg-action-executor.test.ts) — this
 * file mocks them so it never touches a real database. The confirmation
 * mechanism itself (qg-action-confirmation.ts) is NOT mocked — these
 * tests exercise the real token logic, since proving the adapter can
 * never reach a mutation without a genuine, validated token is the whole
 * point of FASE 15B-3.
 */
vi.mock("@/services/qg-command-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/qg-command-router")>();
  return { ...actual, executeQgCommand: vi.fn() };
});
vi.mock("@/services/qg-action-executor", () => ({ executeQgAction: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from "next/cache";
import { executeQgCommand } from "@/services/qg-command-router";
import { executeQgAction } from "@/services/qg-action-executor";
import {
  runClaudeLabQuery,
  runClaudeLabActionCandidates,
  runClaudeLabActionConfirm,
  runClaudeLabRequest,
} from "./claude-lab-adapter";

const mockedExecuteQgCommand = vi.mocked(executeQgCommand);
const mockedExecuteQgAction = vi.mocked(executeQgAction);
const mockedRevalidatePath = vi.mocked(revalidatePath);

describe("runClaudeLabQuery (adapter)", () => {
  const READ_ONLY_CASES: { command: string; fakeResult: QgCommandResult }[] = [
    { command: "GET_LAST_CYCLE", fakeResult: { type: "LAST_CYCLE", hasData: false, target: null, status: null, createdAt: null, agentCount: 0, findingsCount: 0, recommendationsCount: 0 } },
    { command: "GET_RECURRING_FINDINGS", fakeResult: { type: "RECURRING_FINDINGS", items: [] } },
    { command: "GET_PENDING_RECOMMENDATIONS", fakeResult: { type: "PENDING_RECOMMENDATIONS", items: [] } },
    { command: "GET_AGENT_ACTIVITY", fakeResult: { type: "AGENT_ACTIVITY", items: [] } },
    { command: "GET_TEAM_ARCHITECT", fakeResult: { type: "TEAM_ARCHITECT", recommendations: [], insufficientEvidence: [] } },
  ];

  for (const { command, fakeResult } of READ_ONLY_CASES) {
    it(`${command} calls through to executeQgCommand and returns its real result`, async () => {
      mockedExecuteQgCommand.mockReset().mockResolvedValue(fakeResult);

      const response = await runClaudeLabQuery({ command });

      expect(mockedExecuteQgCommand).toHaveBeenCalledWith(command);
      expect(response).toEqual({ success: true, command, result: fakeResult });
    });
  }

  it("rejects a mutation command (APPROVE_RECOMMENDATION) without ever calling executeQgCommand", async () => {
    mockedExecuteQgCommand.mockReset();

    const response = await runClaudeLabQuery({ command: "APPROVE_RECOMMENDATION" });

    expect(mockedExecuteQgCommand).not.toHaveBeenCalled();
    expect(response.success).toBe(false);
    if (!response.success) {
      expect(response.command).toBeNull();
      expect(response.error).not.toMatch(/prisma|stack|at \S+:\d+/i);
    }
  });

  it("rejects a mutation command (CREATE_IMPLEMENTATION) without ever calling executeQgCommand", async () => {
    mockedExecuteQgCommand.mockReset();

    const response = await runClaudeLabQuery({ command: "CREATE_IMPLEMENTATION" });

    expect(mockedExecuteQgCommand).not.toHaveBeenCalled();
    expect(response.success).toBe(false);
  });

  it("rejects an invalid/unknown command id without ever calling executeQgCommand", async () => {
    mockedExecuteQgCommand.mockReset();

    const response = await runClaudeLabQuery({ command: "DELETE_ALL_AGENTS" });

    expect(mockedExecuteQgCommand).not.toHaveBeenCalled();
    expect(response.success).toBe(false);
    if (!response.success) {
      expect(response.command).toBeNull();
    }
  });

  it("sanitizes a failure from executeQgCommand into a clean message, never a raw error", async () => {
    mockedExecuteQgCommand.mockReset().mockRejectedValue(new Error("Can't reach database server at 127.0.0.1:5432"));

    const response = await runClaudeLabQuery({ command: "GET_LAST_CYCLE" });

    expect(response.success).toBe(false);
    if (!response.success) {
      expect(response.command).toBe("GET_LAST_CYCLE");
      expect(response.error).not.toMatch(/127\.0\.0\.1|prisma/i);
    }
  });
});

function recommendationCandidate(id: string): RecommendationCandidate {
  return { id, title: `Recommendation ${id}`, summary: "s", impact: "HIGH", confidence: "MEDIUM" };
}

function implementationCandidate(recommendationId: string): ImplementationCandidate {
  return { recommendationId, title: `Implementation for ${recommendationId}`, summary: "s", impact: "HIGH", confidence: "MEDIUM" };
}

function validationCandidate(implementationId: string): ValidationCandidate {
  return { implementationId, recommendationId: "rec-x", recommendationTitle: "Recommendation x", implementationSummary: "s" };
}

/** Builds the exact candidate shape executeQgCommand(action) really returns for each QgActionId, keyed by the targetId the test expects back. */
function candidateFor(action: QgActionId, targetId: string): RecommendationCandidate | ImplementationCandidate | ValidationCandidate {
  if (action === "APPROVE_RECOMMENDATION" || action === "IGNORE_RECOMMENDATION") return recommendationCandidate(targetId);
  if (action === "CREATE_IMPLEMENTATION") return implementationCandidate(targetId);
  return validationCandidate(targetId);
}

describe("runClaudeLabActionCandidates (FASE 15B-3)", () => {
  it("lists real candidates for a valid action, each carrying its own confirmation token — never mutating", async () => {
    mockedExecuteQgCommand.mockReset().mockResolvedValue({
      type: "ACTION_CANDIDATES",
      action: "APPROVE_RECOMMENDATION",
      candidates: [recommendationCandidate("rec-1")],
    });
    mockedExecuteQgAction.mockReset();

    const response = await runClaudeLabActionCandidates({ command: "APPROVE_RECOMMENDATION" });

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.candidates).toHaveLength(1);
      expect(response.candidates[0]).toMatchObject({ targetId: "rec-1", title: "Recommendation rec-1" });
      expect(typeof response.candidates[0].token).toBe("string");
      expect(typeof response.candidates[0].expiresAt).toBe("number");
    }
    expect(mockedExecuteQgAction).not.toHaveBeenCalled();
  });

  it("rejects a read-only command id (GET_LAST_CYCLE) — not a valid action", async () => {
    mockedExecuteQgCommand.mockReset();
    const response = await runClaudeLabActionCandidates({ command: "GET_LAST_CYCLE" });
    expect(response.success).toBe(false);
    expect(mockedExecuteQgCommand).not.toHaveBeenCalled();
  });

  it("rejects an unknown command id", async () => {
    mockedExecuteQgCommand.mockReset();
    const response = await runClaudeLabActionCandidates({ command: "DELETE_ALL_AGENTS" });
    expect(response.success).toBe(false);
    expect(mockedExecuteQgCommand).not.toHaveBeenCalled();
  });

  it("returns an empty candidate list (not an error) when there's no active project", async () => {
    mockedExecuteQgCommand.mockReset().mockResolvedValue({ type: "NO_ACTIVE_PROJECT" });
    const response = await runClaudeLabActionCandidates({ command: "IGNORE_RECOMMENDATION" });
    expect(response).toEqual({ success: true, command: "IGNORE_RECOMMENDATION", candidates: [] });
  });
});

describe("runClaudeLabActionConfirm (FASE 15B-3 — the critical test)", () => {
  afterEach(() => {
    vi.useRealTimers();
    mockedRevalidatePath.mockReset();
  });

  it("CRITICAL: action_confirm without a real token is REJECTED and executeQgAction is never called", async () => {
    mockedExecuteQgAction.mockReset();

    const response = await runClaudeLabActionConfirm({ command: "APPROVE_RECOMMENDATION", targetId: "rec-1", token: "" });

    expect(response.success).toBe(false);
    expect(mockedExecuteQgAction).not.toHaveBeenCalled();
  });

  it("a garbage/unknown token is rejected, executeQgAction never called", async () => {
    mockedExecuteQgAction.mockReset();
    const response = await runClaudeLabActionConfirm({ command: "APPROVE_RECOMMENDATION", targetId: "rec-1", token: "not-a-real-token" });
    expect(response.success).toBe(false);
    expect(mockedExecuteQgAction).not.toHaveBeenCalled();
  });

  it("a token minted for a different action is rejected, executeQgAction never called", async () => {
    mockedExecuteQgCommand.mockReset().mockResolvedValue({
      type: "ACTION_CANDIDATES",
      action: "APPROVE_RECOMMENDATION",
      candidates: [recommendationCandidate("rec-2")],
    });
    mockedExecuteQgAction.mockReset();

    const candidates = await runClaudeLabActionCandidates({ command: "APPROVE_RECOMMENDATION" });
    const token = candidates.success ? candidates.candidates[0].token : "";

    const response = await runClaudeLabActionConfirm({ command: "CREATE_IMPLEMENTATION", targetId: "rec-2", token });

    expect(response.success).toBe(false);
    expect(mockedExecuteQgAction).not.toHaveBeenCalled();
  });

  it("a token minted for a different targetId is rejected, executeQgAction never called", async () => {
    mockedExecuteQgCommand.mockReset().mockResolvedValue({
      type: "ACTION_CANDIDATES",
      action: "APPROVE_RECOMMENDATION",
      candidates: [recommendationCandidate("rec-3")],
    });
    mockedExecuteQgAction.mockReset();

    const candidates = await runClaudeLabActionCandidates({ command: "APPROVE_RECOMMENDATION" });
    const token = candidates.success ? candidates.candidates[0].token : "";

    const response = await runClaudeLabActionConfirm({ command: "APPROVE_RECOMMENDATION", targetId: "some-other-rec", token });

    expect(response.success).toBe(false);
    expect(mockedExecuteQgAction).not.toHaveBeenCalled();
  });

  it("a reused (already-consumed) token is rejected on the second attempt", async () => {
    mockedExecuteQgCommand.mockReset().mockResolvedValue({
      type: "ACTION_CANDIDATES",
      action: "APPROVE_RECOMMENDATION",
      candidates: [recommendationCandidate("rec-4")],
    });
    mockedExecuteQgAction.mockReset().mockResolvedValue({ action: "APPROVE_RECOMMENDATION", message: 'Recommendation "x" aprovada.' });

    const candidates = await runClaudeLabActionCandidates({ command: "APPROVE_RECOMMENDATION" });
    const token = candidates.success ? candidates.candidates[0].token : "";

    const first = await runClaudeLabActionConfirm({ command: "APPROVE_RECOMMENDATION", targetId: "rec-4", token });
    expect(first.success).toBe(true);
    expect(mockedExecuteQgAction).toHaveBeenCalledTimes(1);

    const second = await runClaudeLabActionConfirm({ command: "APPROVE_RECOMMENDATION", targetId: "rec-4", token });
    expect(second.success).toBe(false);
    expect(mockedExecuteQgAction).toHaveBeenCalledTimes(1); // still 1 — reuse never reached it
  });

  it("rejects an invalid/unknown action even with a token present", async () => {
    mockedExecuteQgAction.mockReset();
    const response = await runClaudeLabActionConfirm({ command: "DELETE_ALL_AGENTS", targetId: "x", token: "whatever" });
    expect(response.success).toBe(false);
    expect(mockedExecuteQgAction).not.toHaveBeenCalled();
  });

  it("FASE 15E: a real mutation that succeeded is still reported as success even when revalidatePath() throws (e.g. called outside a Next.js request context, like scripts/claude-lab-confirm.ts)", async () => {
    mockedExecuteQgCommand.mockReset().mockResolvedValue({
      type: "ACTION_CANDIDATES",
      action: "APPROVE_RECOMMENDATION",
      candidates: [recommendationCandidate("rec-revalidate")],
    });
    mockedExecuteQgAction.mockReset().mockResolvedValue({ action: "APPROVE_RECOMMENDATION", message: "ok" });
    mockedRevalidatePath.mockReset().mockImplementation(() => {
      throw new Error("Invariant: static generation store missing in revalidatePath /qg");
    });

    const candidates = await runClaudeLabActionCandidates({ command: "APPROVE_RECOMMENDATION" });
    const token = candidates.success ? candidates.candidates[0].token : "";

    const response = await runClaudeLabActionConfirm({ command: "APPROVE_RECOMMENDATION", targetId: "rec-revalidate", token });

    expect(response).toEqual({ success: true, command: "APPROVE_RECOMMENDATION", message: "ok" });
    expect(mockedExecuteQgAction).toHaveBeenCalledTimes(1);
  });

  it("FASE 15B-4: a real token that has expired is rejected through the adapter's own action_confirm path, executeQgAction never called", async () => {
    mockedExecuteQgCommand.mockReset().mockResolvedValue({
      type: "ACTION_CANDIDATES",
      action: "APPROVE_RECOMMENDATION",
      candidates: [recommendationCandidate("rec-exp")],
    });
    mockedExecuteQgAction.mockReset();

    const candidates = await runClaudeLabActionCandidates({ command: "APPROVE_RECOMMENDATION" });
    const token = candidates.success ? candidates.candidates[0].token : "";

    vi.useFakeTimers();
    vi.advanceTimersByTime(3 * 60 * 1000); // past the 2-minute TTL
    const response = await runClaudeLabActionConfirm({ command: "APPROVE_RECOMMENDATION", targetId: "rec-exp", token });
    vi.useRealTimers();

    expect(response.success).toBe(false);
    expect(mockedExecuteQgAction).not.toHaveBeenCalled();
  });

  for (const action of ["APPROVE_RECOMMENDATION", "IGNORE_RECOMMENDATION", "CREATE_IMPLEMENTATION", "CREATE_VALIDATION"] as const) {
    it(`a valid, matching token lets ${action} execute exactly once`, async () => {
      mockedExecuteQgCommand.mockReset().mockResolvedValue({
        type: "ACTION_CANDIDATES",
        action,
        candidates: [candidateFor(action as QgActionId, `target-${action}`)],
      } as QgCommandResult);
      mockedExecuteQgAction.mockReset().mockResolvedValue({ action, message: "ok" });

      const candidates = await runClaudeLabActionCandidates({ command: action });
      const token = candidates.success ? candidates.candidates[0].token : "";

      const response = await runClaudeLabActionConfirm({ command: action, targetId: `target-${action}`, token });

      expect(response).toEqual({ success: true, command: action, message: "ok" });
      expect(mockedExecuteQgAction).toHaveBeenCalledTimes(1);
      expect(mockedExecuteQgAction).toHaveBeenCalledWith(action, `target-${action}`);
    });
  }
});

describe("runClaudeLabRequest (FASE 15B-3 — unified contract)", () => {
  it("dispatches kind: query to runClaudeLabQuery", async () => {
    mockedExecuteQgCommand.mockReset().mockResolvedValue({ type: "RECURRING_FINDINGS", items: [] });
    const response = await runClaudeLabRequest({ kind: "query", command: "GET_RECURRING_FINDINGS" });
    expect(response).toMatchObject({ kind: "query", success: true });
  });

  it("dispatches kind: action_candidates to runClaudeLabActionCandidates", async () => {
    mockedExecuteQgCommand.mockReset().mockResolvedValue({ type: "ACTION_CANDIDATES", action: "APPROVE_RECOMMENDATION", candidates: [] });
    const response = await runClaudeLabRequest({ kind: "action_candidates", command: "APPROVE_RECOMMENDATION" });
    expect(response).toMatchObject({ kind: "action_candidates", success: true, candidates: [] });
  });

  it("dispatches kind: action_confirm to runClaudeLabActionConfirm, and a missing token is rejected without calling executeQgAction", async () => {
    mockedExecuteQgAction.mockReset();
    const response = await runClaudeLabRequest({ kind: "action_confirm", command: "APPROVE_RECOMMENDATION", targetId: "x", token: "" });
    expect(response).toMatchObject({ kind: "action_confirm", success: false });
    expect(mockedExecuteQgAction).not.toHaveBeenCalled();
  });

  // FASE 15B-4 — a real external caller is not bound by TypeScript at runtime
  // (the file's own top-of-file comment already says this about `command`/
  // `action`): these prove a malformed `kind`, or a well-known `kind` with
  // fields missing, is rejected as a clean, structured result — never
  // `undefined`, never a thrown TypeError, and never a mutation.
  it("MALFORMED: an unrecognized `kind` is rejected cleanly, never returns undefined, never calls executeQgAction", async () => {
    mockedExecuteQgAction.mockReset();
    mockedExecuteQgCommand.mockReset();

    const response = await runClaudeLabRequest({ kind: "unknown" } as unknown as Parameters<typeof runClaudeLabRequest>[0]);

    expect(response).toBeDefined();
    expect(response).toMatchObject({ success: false });
    expect(mockedExecuteQgAction).not.toHaveBeenCalled();
    expect(mockedExecuteQgCommand).not.toHaveBeenCalled();
  });

  it("MALFORMED: action_confirm with targetId/token missing is rejected, never calls executeQgAction", async () => {
    mockedExecuteQgAction.mockReset();

    const response = await runClaudeLabRequest({ kind: "action_confirm", command: "APPROVE_RECOMMENDATION" } as unknown as Parameters<typeof runClaudeLabRequest>[0]);

    expect(response).toMatchObject({ kind: "action_confirm", success: false });
    expect(mockedExecuteQgAction).not.toHaveBeenCalled();
  });

  it("MALFORMED: a null request is rejected cleanly, never throws, never calls executeQgAction", async () => {
    mockedExecuteQgAction.mockReset();
    mockedExecuteQgCommand.mockReset();

    let response: unknown;
    let threw = false;
    try {
      response = await runClaudeLabRequest(null as unknown as Parameters<typeof runClaudeLabRequest>[0]);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(response).toMatchObject({ success: false });
    expect(mockedExecuteQgAction).not.toHaveBeenCalled();
    expect(mockedExecuteQgCommand).not.toHaveBeenCalled();
  });

  it("MALFORMED: an empty object request is rejected cleanly, never calls executeQgAction", async () => {
    mockedExecuteQgAction.mockReset();
    mockedExecuteQgCommand.mockReset();

    const response = await runClaudeLabRequest({} as unknown as Parameters<typeof runClaudeLabRequest>[0]);

    expect(response).toMatchObject({ success: false });
    expect(mockedExecuteQgAction).not.toHaveBeenCalled();
    expect(mockedExecuteQgCommand).not.toHaveBeenCalled();
  });
});
