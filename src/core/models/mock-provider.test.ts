import { describe, expect, it } from "vitest";
import { agentOutputSchema } from "@/domain/agent-output";
import { MockModelProvider } from "./mock-provider";

const REALISTIC_PROMPT_NEGATIVE = `Task: You are analyzing a test run of the scenario "Novo usuário cria seu primeiro projeto".

1. ACTION: Open the AI Product Lab application in a real browser (Playwright + Chromium).
   EXPECTED: The application responds and renders a real page.
   OBSERVED: Loaded http://localhost:3000/ — page.content() returned 16189 bytes of real HTML.
   EVIDENCE: page.goto("http://localhost:3000/") resolved without error.

2. ACTION: Submit the form to create the project.
   EXPECTED: The new project subsequently appears in the project list.
   OBSERVED: The project name "Test scenario project 123" was NOT found on the page after submitting (waited ~3s).
   EVIDENCE: getText("body") after submit does not contain "Test scenario project 123".

Based ONLY on the observations above, report status "FINDING" ...`;

const REALISTIC_PROMPT_POSITIVE = `Task: You are analyzing a test run of the scenario "Novo usuário cria seu primeiro projeto".

1. ACTION: Open the AI Product Lab application in a real browser (Playwright + Chromium).
   EXPECTED: The application responds and renders a real page.
   OBSERVED: Loaded http://localhost:3000/ — page.content() returned 16189 bytes of real HTML.
   EVIDENCE: page.goto("http://localhost:3000/") resolved without error.

2. ACTION: Submit the form to create the project.
   EXPECTED: The new project subsequently appears in the project list.
   OBSERVED: The project name "Test scenario project 123" is present on the page after submitting.
   EVIDENCE: getText("body") after submit contains "Test scenario project 123".

Based ONLY on the observations above, report status "FINDING" ...`;

const REALISTIC_PROMPT_NOT_AUTOMATED = `Task: You are analyzing a test run.

1. ACTION: From the initial screen, attempt to discover and click a "Projects" link.
   EXPECTED: A visible, clickable link to Projects exists on the initial screen.
   OBSERVED: NOT AUTOMATED — no browser adapter is wired up yet. This step was not actually performed.
   EVIDENCE: browserAdapter is null in this build.

Based ONLY on the observations above, report status "FINDING" ...`;

const PROMPT_WITHOUT_STRUCTURED_EVIDENCE = `Task: Review the checkout flow for general usability.

Context:
(none)`;

// The exact wording task-intents.ts's checkElementExists / plan-executor.ts's
// find step produce for a genuine absence — found missing from
// NEGATIVE_MARKERS during a self-evaluation session: a real, unambiguous
// "the element isn't there" was silently reported as NO_FINDING.
const REALISTIC_PROMPT_ELEMENT_NOT_FOUND = `Task: Abra data:text/html,<button id="entrar">Entrar</button> e clique no botão Entrar e verifique se existe o botão Continuar.

1. ACTION: Open the page in a real browser (Playwright + Chromium).
   EXPECTED: The page responds and renders real content.
   OBSERVED: Loaded data:text/html,<button id="entrar">Entrar</button> — page.content() returned 40 bytes of real HTML.
   EVIDENCE: page.goto(...) resolved without error.

2. ACTION: Click "#entrar".
   EXPECTED: The element matching "#entrar" is clickable and receives the click.
   OBSERVED: Clicked "#entrar" without error.
   EVIDENCE: adapter.click("#entrar") resolved without error.

3. ACTION: Check whether an element matching "botão Continuar" (selector: role=button[name=/Continuar/i]) exists on the page.
   EXPECTED: An element matching "botão Continuar" is present.
   OBSERVED: No element matching "botão Continuar" was found on the page.
   EVIDENCE: exists("role=button[name=/Continuar/i]") -> false.

Based ONLY on the observations above, report status "FINDING" if there is a real, evidenced problem, "NO_FINDING" if everything worked as expected, or "UNCONFIRMED" if unsure.`;

// The exact wording produced when the LAB itself couldn't build a selector
// for the requested element type — also found missing from
// INCONCLUSIVE_MARKERS: this means nothing was actually verified, yet it
// was silently reported as NO_FINDING ("everything worked as expected").
const REALISTIC_PROMPT_NO_SELECTOR = `Task: Abra https://exemplo.com e clique no botão Entrar e verifique se existe o campo de e-mail.

1. ACTION: Determine a reliable selector for "campo de e-mail".
   EXPECTED: A deterministic selector could be built for "campo de e-mail".
   OBSERVED: No deterministic selector could be built for "campo de e-mail".
   EVIDENCE: "campo de e-mail" did not match any known, deterministically mappable element type.

Based ONLY on the observations above, report status "FINDING" if there is a real, evidenced problem, "NO_FINDING" if everything worked as expected, or "UNCONFIRMED" if unsure.`;

describe("MockModelProvider", () => {
  const provider = new MockModelProvider();

  it("self-identifies as the mock provider", () => {
    expect(provider.name).toBe("mock");
  });

  it("reports status FINDING, grounded in the real OBSERVED text, when a step's evidence clearly shows a problem", async () => {
    const result = await provider.completeStructured({
      model: "claude-haiku-4-5",
      system: "You are simulating a first-time user.",
      prompt: REALISTIC_PROMPT_NEGATIVE,
      maxTokens: 800,
      schema: agentOutputSchema,
    });

    expect(result.data).not.toBeNull();
    const parsed = agentOutputSchema.safeParse(result.data);
    expect(parsed.success).toBe(true);
    expect(result.data?.status).toBe("FINDING");
    expect(result.data?.evidence).toContain("was NOT found on the page after submitting");
    expect(result.data?.classification).not.toBeNull();
    expect(result.data?.impact).not.toBeNull();
    expect(result.data?.recommendation).not.toBeNull();
    // Never a real API call — token usage is genuinely zero.
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it("reports status NO_FINDING when every OBSERVED result matches what was expected", async () => {
    const result = await provider.completeStructured({
      model: "claude-haiku-4-5",
      system: "You are simulating a first-time user.",
      prompt: REALISTIC_PROMPT_POSITIVE,
      maxTokens: 800,
      schema: agentOutputSchema,
    });

    expect(agentOutputSchema.safeParse(result.data).success).toBe(true);
    expect(result.data?.status).toBe("NO_FINDING");
    expect(result.data?.finding).toBeNull();
    expect(result.data?.evidence).toBeNull();
  });

  it("reports status UNCONFIRMED — never a FINDING — when a step was not automated", async () => {
    const result = await provider.completeStructured({
      model: "claude-haiku-4-5",
      system: "You are simulating a first-time user.",
      prompt: REALISTIC_PROMPT_NOT_AUTOMATED,
      maxTokens: 800,
      schema: agentOutputSchema,
    });

    expect(agentOutputSchema.safeParse(result.data).success).toBe(true);
    expect(result.data?.status).toBe("UNCONFIRMED");
  });

  it("reports status UNCONFIRMED when there is no structured OBSERVED evidence in the prompt at all", async () => {
    const result = await provider.completeStructured({
      model: "claude-haiku-4-5",
      system: "You are a generic agent.",
      prompt: PROMPT_WITHOUT_STRUCTURED_EVIDENCE,
      maxTokens: 800,
      schema: agentOutputSchema,
    });

    expect(agentOutputSchema.safeParse(result.data).success).toBe(true);
    expect(result.data?.status).toBe("UNCONFIRMED");
  });

  it("reports status FINDING when the real Observation shows a requested element is genuinely absent (\"no element matching ... was found\")", async () => {
    const result = await provider.completeStructured({
      model: "claude-haiku-4-5",
      system: "You are qa-agent.",
      prompt: REALISTIC_PROMPT_ELEMENT_NOT_FOUND,
      maxTokens: 800,
      schema: agentOutputSchema,
    });

    expect(agentOutputSchema.safeParse(result.data).success).toBe(true);
    expect(result.data?.status).toBe("FINDING");
    expect(result.data?.evidence).toContain('No element matching "botão Continuar" was found on the page.');
    expect(result.data?.classification).not.toBeNull();
    expect(result.data?.impact).not.toBeNull();
    expect(result.data?.recommendation).not.toBeNull();
  });

  it("reports status UNCONFIRMED — never NO_FINDING — when the LAB itself couldn't build a selector to check anything", async () => {
    const result = await provider.completeStructured({
      model: "claude-haiku-4-5",
      system: "You are qa-agent.",
      prompt: REALISTIC_PROMPT_NO_SELECTOR,
      maxTokens: 800,
      schema: agentOutputSchema,
    });

    expect(agentOutputSchema.safeParse(result.data).success).toBe(true);
    expect(result.data?.status).toBe("UNCONFIRMED");
  });

  it("is deterministic — the same prompt always produces the same output", async () => {
    const first = await provider.completeStructured({
      model: "claude-haiku-4-5",
      system: "s",
      prompt: REALISTIC_PROMPT_NEGATIVE,
      maxTokens: 800,
      schema: agentOutputSchema,
    });
    const second = await provider.completeStructured({
      model: "claude-haiku-4-5",
      system: "s",
      prompt: REALISTIC_PROMPT_NEGATIVE,
      maxTokens: 800,
      schema: agentOutputSchema,
    });

    expect(first.data).toEqual(second.data);
  });
});
