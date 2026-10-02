import { describe, expect, it, vi } from "vitest";

/**
 * FASE 15B-2 — proves the Server Action boundary itself never reaches
 * executeQgAction() without a real, matching, unused confirmation token —
 * the actual rule the Fase 15A audit flagged as missing. executeQgAction()
 * is mocked here (its own real behavior is already covered by
 * src/services/qg-action-executor.test.ts) purely so these assertions
 * don't depend on a live database, and so "was it even called" can be
 * observed directly.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/services/qg-action-executor", () => ({
  executeQgAction: vi.fn(),
}));

import { executeQgAction } from "@/services/qg-action-executor";
import { confirmQgActionAction, requestQgActionConfirmationAction } from "./qg-command-actions";

const mockedExecuteQgAction = vi.mocked(executeQgAction);

describe("confirmQgActionAction (FASE 15B-2 confirmation barrier)", () => {
  it("rejects a confirm attempt with no real confirmation (a garbage token) — executeQgAction is never called", async () => {
    mockedExecuteQgAction.mockReset();

    const result = await confirmQgActionAction("APPROVE_RECOMMENDATION", "rec-1", "not-a-real-token");

    expect(result.status).toBe("ERROR");
    expect(mockedExecuteQgAction).not.toHaveBeenCalled();
  });

  it("rejects a confirmation requested for a different action than it is confirmed with — executeQgAction is never called", async () => {
    mockedExecuteQgAction.mockReset();

    const request = await requestQgActionConfirmationAction("APPROVE_RECOMMENDATION", "rec-2");
    expect(request.status).toBe("OK");
    const token = request.status === "OK" ? request.token : "";

    const result = await confirmQgActionAction("CREATE_IMPLEMENTATION", "rec-2", token);

    expect(result.status).toBe("ERROR");
    expect(mockedExecuteQgAction).not.toHaveBeenCalled();
  });

  it("rejects a confirmation requested for a different targetId than it is confirmed with — executeQgAction is never called", async () => {
    mockedExecuteQgAction.mockReset();

    const request = await requestQgActionConfirmationAction("IGNORE_RECOMMENDATION", "rec-A");
    const token = request.status === "OK" ? request.token : "";

    const result = await confirmQgActionAction("IGNORE_RECOMMENDATION", "rec-B", token);

    expect(result.status).toBe("ERROR");
    expect(mockedExecuteQgAction).not.toHaveBeenCalled();
  });

  it("with a real, matching confirmation, calls executeQgAction exactly once and returns its result", async () => {
    mockedExecuteQgAction.mockReset().mockResolvedValue({ action: "CREATE_VALIDATION", message: 'Validation criada (status PENDING).' });

    const request = await requestQgActionConfirmationAction("CREATE_VALIDATION", "impl-1");
    expect(request.status).toBe("OK");
    const token = request.status === "OK" ? request.token : "";

    const result = await confirmQgActionAction("CREATE_VALIDATION", "impl-1", token);

    expect(mockedExecuteQgAction).toHaveBeenCalledTimes(1);
    expect(mockedExecuteQgAction).toHaveBeenCalledWith("CREATE_VALIDATION", "impl-1");
    expect(result).toEqual({ status: "OK", message: "Validation criada (status PENDING)." });
  });

  it("the same confirmation cannot be reused for a second confirm attempt", async () => {
    mockedExecuteQgAction.mockReset().mockResolvedValue({ action: "APPROVE_RECOMMENDATION", message: 'Recommendation "x" aprovada.' });

    const request = await requestQgActionConfirmationAction("APPROVE_RECOMMENDATION", "rec-3");
    const token = request.status === "OK" ? request.token : "";

    const first = await confirmQgActionAction("APPROVE_RECOMMENDATION", "rec-3", token);
    expect(first.status).toBe("OK");
    expect(mockedExecuteQgAction).toHaveBeenCalledTimes(1);

    const second = await confirmQgActionAction("APPROVE_RECOMMENDATION", "rec-3", token);
    expect(second.status).toBe("ERROR");
    expect(mockedExecuteQgAction).toHaveBeenCalledTimes(1); // still 1 — the reuse never reached it
  });

  it("requestQgActionConfirmationAction rejects an action outside the known allow-list, without minting a token", async () => {
    const request = await requestQgActionConfirmationAction("DELETE_ALL_AGENTS", "x");
    expect(request.status).toBe("ERROR");
  });
});
