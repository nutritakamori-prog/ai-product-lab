import { describe, expect, it, afterEach } from "vitest";
import {
  estimateCost,
  MODEL_TIER_TO_ID,
  getModelProvider,
  setModelProviderForTesting,
  type ModelProvider,
} from "./provider";

describe("estimateCost", () => {
  it("computes cost from published per-million-token pricing", () => {
    // claude-sonnet-5: $2/$10 per 1M tokens
    const cost = estimateCost("claude-sonnet-5", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(2 + 10, 5);
  });

  it("scales linearly with token count", () => {
    const cost = estimateCost("claude-haiku-4-5", 500_000, 100_000);
    // $1/1M input, $5/1M output
    expect(cost).toBeCloseTo(0.5 * 1 + 0.1 * 5, 5);
  });

  it("returns 0 for an unknown model instead of throwing", () => {
    expect(estimateCost("some-future-model", 1000, 1000)).toBe(0);
  });

  it("returns 0 for zero tokens", () => {
    expect(estimateCost("claude-opus-5", 0, 0)).toBe(0);
  });
});

describe("MODEL_TIER_TO_ID", () => {
  it("maps all three tiers to a concrete model id", () => {
    expect(MODEL_TIER_TO_ID.LOW_COST).toBe("claude-haiku-4-5");
    expect(MODEL_TIER_TO_ID.BALANCED).toBe("claude-sonnet-5");
    expect(MODEL_TIER_TO_ID.HIGH_REASONING).toBe("claude-opus-5");
  });
});

describe("getModelProvider / setModelProviderForTesting", () => {
  afterEach(() => {
    setModelProviderForTesting(null);
  });

  it("returns whatever provider was injected for testing", () => {
    const fake: ModelProvider = {
      completeStructured: async () => ({
        data: null,
        rawText: null,
        inputTokens: 0,
        outputTokens: 0,
        stopReason: null,
      }),
    };
    setModelProviderForTesting(fake);
    expect(getModelProvider()).toBe(fake);
  });
});
