import { afterEach, describe, expect, it } from "vitest";
import { setModelProviderForTesting, type ModelProvider } from "@/core/models/provider";
import { MockModelProvider } from "@/core/models/mock-provider";
import { planTask, validatePlannerOutput } from "./task-planner";
import { executePlan } from "./plan-executor";

/** Returns outputs[callIndex] (last one repeats past the end) — no real LLM call. */
function sequentialProvider(outputs: unknown[]): ModelProvider {
  let callIndex = 0;
  return {
    name: "task-planner-test-provider",
    completeStructured: async <T>() => {
      const data = outputs[Math.min(callIndex, outputs.length - 1)];
      callIndex += 1;
      return {
        data: data as T,
        rawText: JSON.stringify(data),
        inputTokens: 10,
        outputTokens: 10,
        stopReason: "end_turn",
      };
    },
  };
}

describe("planTask", () => {
  afterEach(() => {
    setModelProviderForTesting(null);
  });

  it("1. produces the expected Plan for the one supported sentence, via the real Mock provider", async () => {
    // The real, unmocked MockModelProvider — proves the small addition made
    // to it (see mock-provider.ts's TASK_PLANNER_SYSTEM_MARKER handling)
    // actually works, exactly as getModelProvider() would return it in this
    // environment (no ANTHROPIC_API_KEY configured).
    setModelProviderForTesting(new MockModelProvider());

    const plan = await planTask("Abra https://exemplo.com e verifique se existe um botão de cadastro.");

    expect(plan).toEqual([
      { action: "navigate", target: "https://exemplo.com" },
      { action: "find", target: "um botão de cadastro" },
    ]);
  });

  it("3. returns null when the model explicitly can't represent the task — never a guessed Plan", async () => {
    setModelProviderForTesting(sequentialProvider([{ actions: [] }]));

    const plan = await planTask("Organize uma reunião para amanhã às 10h.");

    expect(plan).toBeNull();
  });

  it("4. a real provider failure propagates as an exception — never becomes null", async () => {
    setModelProviderForTesting({
      name: "must-throw",
      completeStructured: async () => {
        throw new Error("network error");
      },
    });

    await expect(planTask("Abra https://exemplo.com e verifique se existe um botão de cadastro.")).rejects.toThrow(
      "network error",
    );
  });

  it("4b. a provider that resolves with no data (schema parse failure) also throws — never becomes null", async () => {
    setModelProviderForTesting({
      name: "returns-no-data",
      completeStructured: async () => ({
        data: null,
        rawText: null,
        inputTokens: 0,
        outputTokens: 0,
        stopReason: "max_tokens",
      }),
    });

    await expect(planTask("Abra https://exemplo.com e verifique se existe um botão de cadastro.")).rejects.toThrow();
  });

  it("4c. a provider that returns an invalid Plan (schema validation fails) throws — never becomes null", async () => {
    setModelProviderForTesting(sequentialProvider([{ actions: [{ action: "scroll", target: "x" }] }]));

    await expect(planTask("Abra https://exemplo.com e verifique se existe um botão de cadastro.")).rejects.toThrow(
      /invalid Plan/,
    );
  });
});

/**
 * MockModelProvider now recognizes a second, still-hardcoded sentence shape
 * (see mock-provider.ts's MOCK_PLAN_3_STEP_PATTERN) — a 3-clause
 * "navigate → click → find" task. Uses the real, unmocked MockModelProvider
 * throughout — the ONLY provider actually available in this environment (no
 * ANTHROPIC_API_KEY configured) — never a simulation of what a real model
 * would do.
 */
describe("planTask — 3-step task (navigate → click → find, button/link only)", () => {
  afterEach(() => {
    setModelProviderForTesting(null);
  });

  // Spaces are percent-encoded (%20) so the URL itself is a single
  // whitespace-free token — required for MOCK_PLAN_3_STEP_PATTERN's (\S+)
  // capture to grab the whole URL when it's embedded in the sentence below;
  // Chromium decodes it correctly, so the real HTML/attributes are identical
  // to the un-encoded version used elsewhere (e.g. plan-executor.test.ts).
  const DATA_URL =
    'data:text/html,<button%20id="entrar"%20onclick="document.getElementById(\'slot\').innerHTML=\'<button>Continuar</button>\'">Entrar</button><div%20id="slot"></div>';
  const TASK = `Abra ${DATA_URL} e clique no botão Entrar e verifique se existe o botão Continuar.`;

  it("1. the new 3-clause shape is recognized and produces exactly navigate → click → find, in order", async () => {
    setModelProviderForTesting(new MockModelProvider());

    const plan = await planTask(TASK);

    expect(plan).toEqual([
      { action: "navigate", target: DATA_URL },
      { action: "click", target: "#entrar" },
      { action: "find", target: "botão Continuar" },
    ]);
  });

  it("2. the original 2-clause shape still works exactly as before", async () => {
    setModelProviderForTesting(new MockModelProvider());

    const plan = await planTask("Abra https://exemplo.com e verifique se existe um botão de cadastro.");

    expect(plan).toEqual([
      { action: "navigate", target: "https://exemplo.com" },
      { action: "find", target: "um botão de cadastro" },
    ]);
  });

  it("3. an unrecognized sentence still returns null — never a guessed Plan", async () => {
    setModelProviderForTesting(new MockModelProvider());

    const plan = await planTask("Abra https://exemplo.com e preencha o formulário de cadastro inteiro.");

    expect(plan).toBeNull();
  });

  it("4. real flow: planTask() + executePlan() — the Plan really executes, click really changes the page, find really locates Continuar", async () => {
    setModelProviderForTesting(new MockModelProvider());

    const plan = await planTask(TASK);
    expect(plan).not.toBeNull();

    const observations = await executePlan(plan!);

    expect(observations).toHaveLength(3);
    expect(observations[0].evidence).toContain("page.goto(");
    expect(observations[1].observed).toBe('Clicked "#entrar" without error.');
    expect(observations[2].action).toContain("role=button[name=/Continuar/i]");
    expect(observations[2].observed).toBe('An element matching "botão Continuar" was found on the page.');
    expect(observations[2].evidence).toBe('exists("role=button[name=/Continuar/i]") -> true.');
  });
});

describe("validatePlannerOutput", () => {
  it("2. an unknown action type never validates — it can never reach executePlan()", () => {
    const result = validatePlannerOutput({ actions: [{ action: "scroll", target: "x" }] });
    expect(result.valid).toBe(false);
  });

  it("2. a missing required field never validates", () => {
    // "fill" requires both target and value — value is missing here.
    const result = validatePlannerOutput({ actions: [{ action: "fill", target: "#name" }] });
    expect(result.valid).toBe(false);
  });

  it("a well-formed response validates and preserves the actions", () => {
    const result = validatePlannerOutput({
      actions: [
        { action: "navigate", target: "https://exemplo.com" },
        { action: "find", target: "um botão de cadastro" },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.data?.actions).toHaveLength(2);
  });
});
