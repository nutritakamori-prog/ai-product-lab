import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { ModelTier } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";

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
 */
export interface ModelProvider {
  completeStructured<T>(
    params: StructuredCompletionParams<T>,
  ): Promise<StructuredCompletionResult<T>>;
}

class AnthropicModelProvider implements ModelProvider {
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

let cachedProvider: ModelProvider | null = null;

export function getModelProvider(): ModelProvider {
  if (!cachedProvider) cachedProvider = new AnthropicModelProvider();
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
