import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("getEnv", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns the parsed env when required variables are present", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.ANTHROPIC_API_KEY = "sk-test-123";

    const { getEnv: freshGetEnv } = await import("./env");
    const env = freshGetEnv();

    expect(env.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/db");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-test-123");
  });

  it("throws a descriptive error when a required variable is missing", async () => {
    delete process.env.DATABASE_URL;
    process.env.ANTHROPIC_API_KEY = "sk-test-123";

    const { getEnv: freshGetEnv } = await import("./env");

    expect(() => freshGetEnv()).toThrow(/DATABASE_URL/);
  });

  it("treats an empty ANTHROPIC_API_KEY the same as unset, not as invalid", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.ANTHROPIC_API_KEY = "";

    const { getEnv: freshGetEnv } = await import("./env");
    const env = freshGetEnv();

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("caches the result after the first successful call", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.ANTHROPIC_API_KEY = "sk-test-123";

    const { getEnv: freshGetEnv } = await import("./env");
    const first = freshGetEnv();

    // Mutating process.env after the first call should not affect the cached result.
    process.env.DATABASE_URL = "postgresql://changed/db";
    const second = freshGetEnv();

    expect(second).toBe(first);
    expect(second.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/db");
  });
});
