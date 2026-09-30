import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ModelTier } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";
import { MockModelProvider } from "./mock-provider";

/**
 * Maps our three abstract tiers (see docs/DECISIONS.md) to concrete Anthropic
 * model IDs. This is the ONLY place a concrete model id is chosen — everything
 * else in the Runtime talks in tiers, so swapping a model (or a whole provider)
 * later means editing this file, not every call site.
 */
export const MODEL_TIER_TO_ID: Record<ModelTier, string> = {
  LOW_COST: "claude-haiku-4-5",
  BALANCED: "claude-sonnet-5",
  HIGH_REASONING: "claude-opus-5",
};

// USD per 1M tokens. Source: Anthropic's published pricing, checked 2026-09-23.
// Update here if pricing changes — nowhere else references these numbers.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
  "claude-opus-5": { input: 5.0, output: 25.0 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

export interface StructuredCompletionParams<T> {
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  schema: z.ZodType<T>;
}

export interface StructuredCompletionResult<T> {
  data: T | null;
  rawText: string | null;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
}

/**
 * Abstraction over "call an LLM and get structured output back". The Runtime
 * only ever talks to this interface — never to the Anthropic SDK directly —
 * so a future second provider (or a test fake) is a drop-in.
 *
 * `name` is a short, stable self-identifier ("anthropic", "mock", ...) —
 * runAgent() records it on the AgentExecution row so a mock-backed run is
 * never mistaken for a real one. A test double should set its own
 * descriptive name (e.g. "fake-test-provider"), not borrow "anthropic" or
 * "mock".
 */
export interface ModelProvider {
  readonly name: string;
  completeStructured<T>(
    params: StructuredCompletionParams<T>,
  ): Promise<StructuredCompletionResult<T>>;
}

class AnthropicModelProvider implements ModelProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor() {
    const apiKey = getEnv().ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. The Agent Runtime needs it to call Claude — add it to .env.",
      );
    }
    this.client = new Anthropic({ apiKey });
  }

  async completeStructured<T>(
    params: StructuredCompletionParams<T>,
  ): Promise<StructuredCompletionResult<T>> {
    const response = await this.client.messages.parse({
      model: params.model,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: [{ role: "user", content: params.prompt }],
      output_config: { format: zodOutputFormat(params.schema) },
    });

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text",
    );

    return {
      data: response.parsed_output ?? null,
      rawText: textBlock?.text ?? null,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      stopReason: response.stop_reason,
    };
  }
}

// The one place a concrete Gemini model id is chosen — same reasoning as
// MODEL_TIER_TO_ID above, but Gemini doesn't get its own tier table: every
// agent (and the Task Planner) currently runs at LOW_COST anyway, and
// GeminiModelProvider is a small, explicit experiment (see this file's own
// history), not a second fully-tiered provider. Change this one line to try
// a different free-tier-eligible Gemini model.
const GEMINI_MODEL = "gemini-3.8-flash";

/**
 * Best-effort, deliberately small conversion from a Zod-derived JSON Schema
 * (z.toJSONSchema(), built into Zod 4 — no extra dependency) to Gemini's own
 * `responseSchema` shape (a constrained subset of OpenAPI 3.0: uppercase
 * `type`, `nullable` instead of a null union member, `anyOf` for a union of
 * branches — Gemini's Schema message supports `anyOf` natively, unlike
 * `oneOf`/`$ref`). Handles exactly what this project's own schemas need
 * (flat objects, enums, discriminated unions, nullable fields, arrays) —
 * returns `undefined` for anything it genuinely can't represent, so the
 * caller can fall back to `responseMimeType: "application/json"` alone
 * rather than send Gemini a schema that doesn't mean what we think it means.
 */
type JsonSchemaNode = Record<string, unknown>;
type GeminiSchema = Record<string, unknown>;

function toGeminiSchema(node: JsonSchemaNode): GeminiSchema | undefined {
  // A union — z.toJSONSchema() emits "oneOf" for a discriminated union (e.g.
  // task-planner.ts's PLAN_ACTION_SCHEMA: navigate/click/find/fill/getText)
  // and "anyOf" for a plain z.union()/`.nullable()`. Gemini's own Schema
  // message only documents `anyOf`, so both forms are normalized to it here.
  const branches = (node.oneOf ?? node.anyOf) as JsonSchemaNode[] | undefined;
  if (Array.isArray(branches)) {
    // The common, simple case first: exactly one real branch plus a bare
    // null branch (e.g. z.string().min(1).nullable()) — Gemini has no null
    // type, only a `nullable` flag alongside the real type, so this stays a
    // flat schema instead of a genuine anyOf of two alternatives.
    if (branches.length === 2) {
      const nullBranch = branches.find((b) => b.type === "null");
      const realBranch = branches.find((b) => b.type !== "null");
      if (nullBranch && realBranch) {
        const converted = toGeminiSchema(realBranch);
        return converted ? { ...converted, nullable: true } : undefined;
      }
    }

    // The general case: every branch (2+, none of them a plain null) is
    // converted on its own and combined into Gemini's native `anyOf` — the
    // Zod-side validation (schema.safeParse(), including each branch's own
    // .strict()) is completely untouched; this only changes what Gemini is
    // told to conform to when generating its response.
    const converted = branches.map((branch) => toGeminiSchema(branch));
    if (converted.some((b) => !b)) return undefined;
    return { anyOf: converted };
  }

  // Nullable field expressed as type: ["string", "null"] (e.g. a bare
  // z.string().nullable() with no other modifier).
  if (Array.isArray(node.type)) {
    const types = node.type as string[];
    const realType = types.find((t) => t !== "null");
    if (!realType || !types.includes("null")) return undefined;
    return toGeminiSchemaLeaf(realType, node, true);
  }

  if (node.type === "object") {
    const properties: Record<string, GeminiSchema> = {};
    const rawProperties = (node.properties as Record<string, JsonSchemaNode>) ?? {};
    for (const [key, value] of Object.entries(rawProperties)) {
      const converted = toGeminiSchema(value);
      if (!converted) return undefined;
      properties[key] = converted;
    }
    return {
      type: "OBJECT",
      properties,
      ...(Array.isArray(node.required) ? { required: node.required } : {}),
    };
  }

  if (node.type === "array") {
    const items = toGeminiSchema((node.items as JsonSchemaNode) ?? {});
    if (!items) return undefined;
    return { type: "ARRAY", items };
  }

  if (typeof node.type === "string") {
    return toGeminiSchemaLeaf(node.type, node, false);
  }

  return undefined;
}

function toGeminiSchemaLeaf(type: string, node: JsonSchemaNode, nullable: boolean): GeminiSchema | undefined {
  const typeMap: Record<string, string> = { string: "STRING", number: "NUMBER", integer: "INTEGER", boolean: "BOOLEAN" };
  const geminiType = typeMap[type];
  if (!geminiType) return undefined;
  // `const` (e.g. z.literal("navigate"), the discriminator field of a
  // discriminated union) has no equivalent in Gemini's schema — a
  // single-value `enum` means the same thing and IS supported.
  const enumValues = Array.isArray(node.enum) ? node.enum : node.const !== undefined ? [node.const] : undefined;
  return {
    type: geminiType,
    ...(enumValues ? { enum: enumValues } : {}),
    ...(nullable ? { nullable: true } : {}),
  };
}

// Exported only for direct testing (constructing it without GEMINI_API_KEY
// set to prove the constructor's own failure message) — getModelProvider()
// below is still the only production path that ever creates one.
export class GeminiModelProvider implements ModelProvider {
  readonly name = "gemini";
  private readonly apiKey: string;

  constructor() {
    const apiKey = getEnv().GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set. The Agent Runtime needs it to call Gemini — add it to .env.");
    }
    this.apiKey = apiKey;
  }

  async completeStructured<T>(params: StructuredCompletionParams<T>): Promise<StructuredCompletionResult<T>> {
    // `params.model` is the Anthropic-tier-derived id (see MODEL_TIER_TO_ID) —
    // not meaningful to Gemini, so it's intentionally ignored here, the same
    // way MockModelProvider already ignores it. GEMINI_MODEL above is the
    // single, centralized source of truth for which Gemini model actually runs.
    const responseSchema = toGeminiSchema(z.toJSONSchema(params.schema) as JsonSchemaNode);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: params.system }] },
          contents: [{ role: "user", parts: [{ text: params.prompt }] }],
          generationConfig: {
            maxOutputTokens: params.maxTokens,
            responseMimeType: "application/json",
            ...(responseSchema ? { responseSchema } : {}),
          },
        }),
      },
    );

    if (!response.ok) {
      // Never include the request URL (it carries the API key as a query
      // param) in an error message — only the response's own status/body.
      const body = await response.text().catch(() => "");
      throw new Error(`Gemini API request failed with status ${response.status} ${response.statusText}: ${body}`);
    }

    const json = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    const candidate = json.candidates?.[0];
    const rawText = candidate?.content?.parts?.map((part) => part.text ?? "").join("") ?? null;

    let data: T | null = null;
    if (rawText) {
      try {
        const parsedJson: unknown = JSON.parse(rawText);
        const validated = params.schema.safeParse(parsedJson);
        if (validated.success) data = validated.data;
      } catch {
        // Invalid JSON — data stays null, same "couldn't produce valid
        // structured output" outcome the existing retry/exception handling
        // (run-agent.ts / task-planner.ts) already knows how to deal with.
      }
    }

    return {
      data,
      rawText,
      inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      stopReason: candidate?.finishReason ?? null,
    };
  }
}

let cachedProvider: ModelProvider | null = null;

/**
 * Anthropic when ANTHROPIC_API_KEY is configured; otherwise Gemini
 * (src/core/models/provider.ts's own GeminiModelProvider) when GEMINI_API_KEY
 * is configured — a free-tier alternative for validating the agents with a
 * real model without Anthropic's cost; otherwise the deterministic
 * MockModelProvider (src/core/models/mock-provider.ts) automatically — so
 * development on the Test Lab (and anything else calling runAgent()) keeps
 * working without spending real API tokens or needing a manual flag. See
 * docs/DECISIONS.md.
 */
export function getModelProvider(): ModelProvider {
  if (!cachedProvider) {
    const env = getEnv();
    cachedProvider = env.ANTHROPIC_API_KEY
      ? new AnthropicModelProvider()
      : env.GEMINI_API_KEY
        ? new GeminiModelProvider()
        : new MockModelProvider();
  }
  return cachedProvider;
}

/**
 * Test-only escape hatch so the Runtime can be tested without spending real
 * API tokens. Never called from production code paths. Pass `null` to reset
 * back to the real provider.
 */
export function setModelProviderForTesting(provider: ModelProvider | null): void {
  cachedProvider = provider;
}
