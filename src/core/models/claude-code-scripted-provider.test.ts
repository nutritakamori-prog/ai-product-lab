import { describe, expect, it } from "vitest";
import { createClaudeCodeScriptedProvider } from "./claude-code-scripted-provider";

describe("createClaudeCodeScriptedProvider", () => {
  it("reports its name as claude-code, so run-agent.ts's toProviderKind() records it as CLAUDE_CODE", () => {
    const provider = createClaudeCodeScriptedProvider([{ actions: [] }]);
    expect(provider.name).toBe("claude-code");
  });

  it("returns each scripted response in order, one per call", async () => {
    const provider = createClaudeCodeScriptedProvider(["first", "second", "third"]);
    const a = await provider.completeStructured({ model: "x", system: "", prompt: "", maxTokens: 1, schema: {} as never });
    const b = await provider.completeStructured({ model: "x", system: "", prompt: "", maxTokens: 1, schema: {} as never });
    const c = await provider.completeStructured({ model: "x", system: "", prompt: "", maxTokens: 1, schema: {} as never });
    expect([a.data, b.data, c.data]).toEqual(["first", "second", "third"]);
  });

  it("reports zero input/output tokens for every call — no real API usage ever occurs", async () => {
    const provider = createClaudeCodeScriptedProvider(["only"]);
    const result = await provider.completeStructured({ model: "x", system: "", prompt: "", maxTokens: 1, schema: {} as never });
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it("throws an explicit error when asked for more responses than were scripted — never silently returns an empty/undefined result", async () => {
    const provider = createClaudeCodeScriptedProvider(["only-one"]);
    await provider.completeStructured({ model: "x", system: "", prompt: "", maxTokens: 1, schema: {} as never });
    await expect(
      provider.completeStructured({ model: "x", system: "", prompt: "", maxTokens: 1, schema: {} as never }),
    ).rejects.toThrow(/only 1 response\(s\) were scripted/);
  });
});
