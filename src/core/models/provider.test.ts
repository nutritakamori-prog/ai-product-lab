import { describe, expect, it, afterEach, vi } from "vitest";
import { z } from "zod";
import { resetEnvCacheForTesting } from "@/lib/env";
import {
  estimateCost,
  MODEL_TIER_TO_ID,
  getModelProvider,
  setModelProviderForTesting,
  GeminiModelProvider,
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
      name: "fake-test-provider",
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

describe("getModelProvider — Anthropic vs Mock selection", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  // Also saved/cleared here: a real GEMINI_API_KEY may be configured in this
  // environment (see .env), and getModelProvider() now falls back to Gemini
  // before Mock — this describe block is specifically about the
  // Anthropic-absent case still landing on Mock, so it must isolate Gemini's
  // key too, the same way the "Gemini selection" describe block below does.
  const originalGeminiKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
    resetEnvCacheForTesting();
    setModelProviderForTesting(null);
  });

  it("uses the real Anthropic provider when ANTHROPIC_API_KEY is configured", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-a-real-key";
    resetEnvCacheForTesting();
    setModelProviderForTesting(null);

    // Constructing the real AnthropicModelProvider makes no network call —
    // it only stores the SDK client. No real request happens in this test.
    const provider = getModelProvider();

    expect(provider.name).toBe("anthropic");
  });

  it("uses the Mock provider automatically when neither ANTHROPIC_API_KEY nor GEMINI_API_KEY is configured", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    resetEnvCacheForTesting();
    setModelProviderForTesting(null);

    const provider = getModelProvider();

    expect(provider.name).toBe("mock");
  });
});

describe("getModelProvider — Gemini selection", () => {
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const originalGeminiKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
    resetEnvCacheForTesting();
    setModelProviderForTesting(null);
  });

  it("uses Gemini when GEMINI_API_KEY is set and ANTHROPIC_API_KEY is not", () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.GEMINI_API_KEY = "test-not-a-real-key";
    resetEnvCacheForTesting();
    setModelProviderForTesting(null);

    const provider = getModelProvider();

    expect(provider.name).toBe("gemini");
  });

  it("prefers Anthropic over Gemini when both keys are set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-a-real-key";
    process.env.GEMINI_API_KEY = "test-not-a-real-key";
    resetEnvCacheForTesting();
    setModelProviderForTesting(null);

    const provider = getModelProvider();

    expect(provider.name).toBe("anthropic");
  });

  it("still falls back to Mock when neither key is set", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    resetEnvCacheForTesting();
    setModelProviderForTesting(null);

    const provider = getModelProvider();

    expect(provider.name).toBe("mock");
  });
});

/**
 * GeminiModelProvider itself, constructed directly (never through
 * getModelProvider() here, since that already guards construction on the
 * key's presence) — fetch is stubbed, so none of these tests make a real
 * network call.
 */
describe("GeminiModelProvider", () => {
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
    resetEnvCacheForTesting();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const simpleSchema = z.object({
    status: z.enum(["FINDING", "NO_FINDING"]),
    finding: z.string().nullable(),
  });

  function fakeGeminiResponse(bodyText: string, usage = { promptTokenCount: 12, candidatesTokenCount: 8 }) {
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        candidates: [{ content: { parts: [{ text: bodyText }] }, finishReason: "STOP" }],
        usageMetadata: usage,
      }),
    };
  }

  it("1. fails clearly, before any network call, when GEMINI_API_KEY is not set", () => {
    delete process.env.GEMINI_API_KEY;
    resetEnvCacheForTesting();

    expect(() => new GeminiModelProvider()).toThrow(/GEMINI_API_KEY is not set/);
  });

  it("2. sends system and prompt exactly as given, without leaking the API key into the request body", async () => {
    process.env.GEMINI_API_KEY = "test-key-should-not-leak";
    resetEnvCacheForTesting();
    const provider = new GeminiModelProvider();

    const fetchSpy = vi.fn().mockResolvedValue(fakeGeminiResponse(JSON.stringify({ status: "NO_FINDING", finding: null })));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await provider.completeStructured({
      model: "irrelevant-anthropic-id",
      system: "You are qa-agent.",
      prompt: "Task: check the button.",
      maxTokens: 400,
      schema: simpleSchema,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain("test-key-should-not-leak"); // the key travels as a query param, as Gemini's REST API requires
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.system_instruction.parts[0].text).toBe("You are qa-agent.");
    expect(body.contents[0].parts[0].text).toBe("Task: check the button.");
    expect(body).not.toHaveProperty("apiKey"); // the key is never duplicated into the JSON body itself
  });

  it("3a. a structurally valid response is parsed and validated against the given Zod schema", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    resetEnvCacheForTesting();
    const provider = new GeminiModelProvider();
    global.fetch = vi
      .fn()
      .mockResolvedValue(fakeGeminiResponse(JSON.stringify({ status: "FINDING", finding: "The button is missing." }))) as unknown as typeof fetch;

    const result = await provider.completeStructured({
      model: "irrelevant",
      system: "s",
      prompt: "p",
      maxTokens: 400,
      schema: simpleSchema,
    });

    expect(result.data).toEqual({ status: "FINDING", finding: "The button is missing." });
    expect(result.inputTokens).toBe(12);
    expect(result.outputTokens).toBe(8);
    expect(result.stopReason).toBe("STOP");
  });

  it("3b. a response that doesn't match the schema is never coerced — data stays null, exactly like an Anthropic/Mock invalid response", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    resetEnvCacheForTesting();
    const provider = new GeminiModelProvider();
    global.fetch = vi
      .fn()
      .mockResolvedValue(fakeGeminiResponse(JSON.stringify({ status: "SOMETHING_INVALID" }))) as unknown as typeof fetch;

    const result = await provider.completeStructured({
      model: "irrelevant",
      system: "s",
      prompt: "p",
      maxTokens: 400,
      schema: simpleSchema,
    });

    expect(result.data).toBeNull();
    expect(result.rawText).toContain("SOMETHING_INVALID"); // the raw text is still preserved for debugging
  });

  it("4. an API error response is thrown as a clear Error, never leaking the API key", async () => {
    process.env.GEMINI_API_KEY = "test-key-should-not-leak";
    resetEnvCacheForTesting();
    const provider = new GeminiModelProvider();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "quota exceeded",
    }) as unknown as typeof fetch;

    await expect(
      provider.completeStructured({ model: "irrelevant", system: "s", prompt: "p", maxTokens: 400, schema: simpleSchema }),
    ).rejects.toThrow(/429[\s\S]*Too Many Requests[\s\S]*quota exceeded/);

    try {
      await provider.completeStructured({ model: "irrelevant", system: "s", prompt: "p", maxTokens: 400, schema: simpleSchema });
    } catch (err) {
      expect((err as Error).message).not.toContain("test-key-should-not-leak");
    }
  });

  it("5a. a flat, nullable-enum schema (the real shape of agentOutputBaseSchema) is converted into a Gemini responseSchema", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    resetEnvCacheForTesting();
    const provider = new GeminiModelProvider();
    const fetchSpy = vi.fn().mockResolvedValue(fakeGeminiResponse(JSON.stringify({ status: "NO_FINDING", finding: null })));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await provider.completeStructured({ model: "irrelevant", system: "s", prompt: "p", maxTokens: 400, schema: simpleSchema });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema).toEqual({
      type: "OBJECT",
      properties: {
        status: { type: "STRING", enum: ["FINDING", "NO_FINDING"] },
        finding: { type: "STRING", nullable: true },
      },
      required: ["status", "finding"],
    });
  });

  it("5b. a discriminated union (the real shape of task-planner.ts's PLAN_ACTION_SCHEMA) converts into Gemini's native anyOf — this is the fix for the Task Planner's own schema", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    resetEnvCacheForTesting();
    const provider = new GeminiModelProvider();
    const fetchSpy = vi.fn().mockResolvedValue(
      fakeGeminiResponse(JSON.stringify({ actions: [{ action: "navigate", target: "https://exemplo.com" }] })),
    );
    global.fetch = fetchSpy as unknown as typeof fetch;

    // Same shape as task-planner.ts's real PLANNER_RESPONSE_SCHEMA: five
    // action variants sharing {action, target}, with "fill" alone adding a
    // required "value" — the exact case that used to make the whole schema
    // unconvertible (z.toJSONSchema() emits "oneOf" here, which the
    // converter didn't handle at all before this fix).
    const plannerLikeSchema = z.object({
      actions: z.array(
        z.discriminatedUnion("action", [
          z.object({ action: z.literal("navigate"), target: z.string().min(1) }).strict(),
          z.object({ action: z.literal("find"), target: z.string().min(1) }).strict(),
          z.object({ action: z.literal("click"), target: z.string().min(1) }).strict(),
          z.object({ action: z.literal("fill"), target: z.string().min(1), value: z.string() }).strict(),
          z.object({ action: z.literal("getText"), target: z.string().min(1) }).strict(),
        ]),
      ),
    });

    const result = await provider.completeStructured({
      model: "irrelevant",
      system: "s",
      prompt: "p",
      maxTokens: 400,
      schema: plannerLikeSchema,
    });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    const actionsSchema = body.generationConfig.responseSchema?.properties?.actions;
    expect(actionsSchema?.type).toBe("ARRAY");
    expect(Array.isArray(actionsSchema?.items?.anyOf)).toBe(true);
    expect(actionsSchema.items.anyOf).toHaveLength(5);
    // Each branch keeps its own discriminator as a single-value enum
    // (Gemini has no literal/const) and its own required fields — "fill" is
    // the only branch with three, the rest have exactly two.
    const fillBranch = actionsSchema.items.anyOf.find((b: { properties?: Record<string, { enum?: string[] }>; required?: string[] }) => b.properties?.action?.enum?.[0] === "fill");
    expect(fillBranch.required).toEqual(["action", "target", "value"]);
    const navigateBranch = actionsSchema.items.anyOf.find((b: { properties?: Record<string, { enum?: string[] }>; required?: string[] }) => b.properties?.action?.enum?.[0] === "navigate");
    expect(navigateBranch.required).toEqual(["action", "target"]);

    // And the schema.safeParse() validation itself — completely untouched —
    // still accepts a well-formed response and rejects the same things it
    // always rejected; this fix never weakened it.
    expect(result.data).toEqual({ actions: [{ action: "navigate", target: "https://exemplo.com" }] });
  });

  it("5c. a schema this converter genuinely can't represent (e.g. a fixed-length tuple) still falls back to JSON mode with no responseSchema — never a wrong one", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    resetEnvCacheForTesting();
    const provider = new GeminiModelProvider();
    const fetchSpy = vi.fn().mockResolvedValue(fakeGeminiResponse(JSON.stringify({ pair: ["a", 1] })));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const tupleSchema = z.object({ pair: z.tuple([z.string(), z.number()]) });

    await provider.completeStructured({ model: "irrelevant", system: "s", prompt: "p", maxTokens: 400, schema: tupleSchema });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema).toBeUndefined();
  });
});
