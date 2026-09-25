import { z } from "zod";

/**
 * Fail fast, with a clear message, if required environment variables are
 * missing or malformed — instead of a confusing crash deep inside Prisma
 * or the Anthropic SDK later.
 *
 * ANTHROPIC_API_KEY is optional for now: nothing in this codebase calls
 * Anthropic yet (that's Phase 2, Agent Runtime). Make it required again
 * once the runtime actually depends on it — see docs/DECISIONS.md.
 */
const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  ANTHROPIC_API_KEY: optionalString,
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}

/**
 * Test-only escape hatch, same reasoning as
 * core/models/provider.ts's setModelProviderForTesting: getEnv() caches
 * its result, so a test that mutates process.env (e.g. to exercise
 * getModelProvider()'s real Anthropic-vs-Mock selection) needs a way to
 * force the next getEnv() call to re-read it. Never called from production
 * code paths.
 */
export function resetEnvCacheForTesting(): void {
  cached = null;
}
