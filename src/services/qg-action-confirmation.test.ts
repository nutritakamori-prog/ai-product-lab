import { afterEach, describe, expect, it, vi } from "vitest";
import { QG_ACTION_IDS } from "@/core/qg-command-router/qg-command-router";
import { createActionConfirmation, consumeActionConfirmation } from "./qg-action-confirmation";

/**
 * FASE 15B-2 — the confirmation mechanism itself is pure, in-memory logic
 * (no database, no mocking needed): these tests prove the real barrier
 * exists at this layer, which is exactly what confirmQgActionAction
 * (src/app/qg/qg-command-actions.ts) relies on before ever calling
 * executeQgAction().
 */
describe("qg-action-confirmation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a freshly created confirmation validates for the exact action/targetId it was created for", () => {
    const { token } = createActionConfirmation("APPROVE_RECOMMENDATION", "rec-1");
    const check = consumeActionConfirmation(token, "APPROVE_RECOMMENDATION", "rec-1");
    expect(check).toEqual({ valid: true });
  });

  it("works for all four real QgActionId values", () => {
    for (const action of QG_ACTION_IDS) {
      const { token } = createActionConfirmation(action, "target-x");
      expect(consumeActionConfirmation(token, action, "target-x")).toEqual({ valid: true });
    }
  });

  it("rejects creating a confirmation for an action outside the known allow-list", () => {
    expect(() => createActionConfirmation("DELETE_ALL_AGENTS", "x")).toThrow(/ação desconhecida/i);
  });

  it("rejects a nonexistent/garbage token — never a mutation without a real confirmation", () => {
    const check = consumeActionConfirmation("not-a-real-token", "APPROVE_RECOMMENDATION", "rec-1");
    expect(check.valid).toBe(false);
  });

  it("rejects the same token a second time — a confirmation is single-use", () => {
    const { token } = createActionConfirmation("IGNORE_RECOMMENDATION", "rec-2");
    expect(consumeActionConfirmation(token, "IGNORE_RECOMMENDATION", "rec-2")).toEqual({ valid: true });

    const secondAttempt = consumeActionConfirmation(token, "IGNORE_RECOMMENDATION", "rec-2");
    expect(secondAttempt.valid).toBe(false);
  });

  it("rejects a valid token used for a different action than it was created for", () => {
    const { token } = createActionConfirmation("APPROVE_RECOMMENDATION", "rec-3");
    const check = consumeActionConfirmation(token, "CREATE_IMPLEMENTATION", "rec-3");
    expect(check.valid).toBe(false);
  });

  it("rejects a valid token used for a different targetId than it was created for", () => {
    const { token } = createActionConfirmation("APPROVE_RECOMMENDATION", "rec-A");
    const check = consumeActionConfirmation(token, "APPROVE_RECOMMENDATION", "rec-B");
    expect(check.valid).toBe(false);
  });

  it("a mismatched action/targetId attempt does not burn the token — the correct pairing can still succeed afterward", () => {
    const { token } = createActionConfirmation("APPROVE_RECOMMENDATION", "rec-4");
    expect(consumeActionConfirmation(token, "APPROVE_RECOMMENDATION", "wrong-target").valid).toBe(false);
    expect(consumeActionConfirmation(token, "APPROVE_RECOMMENDATION", "rec-4")).toEqual({ valid: true });
  });

  it("rejects an expired confirmation", () => {
    vi.useFakeTimers();
    const { token } = createActionConfirmation("CREATE_VALIDATION", "impl-1");

    vi.advanceTimersByTime(3 * 60 * 1000); // past the 2-minute TTL

    const check = consumeActionConfirmation(token, "CREATE_VALIDATION", "impl-1");
    expect(check.valid).toBe(false);
  });
});
