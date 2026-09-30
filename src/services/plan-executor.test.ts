import { describe, expect, it } from "vitest";
import { launchBrowserAdapter } from "@/core/testing/runner/browser-adapter";
import { executePlan, recognizePlan, type Plan } from "./plan-executor";

/**
 * Proves the EXECUTION layer only — every plan here is hand-written, never
 * produced from a task string (there is no recognizePlan() yet). data: URLs
 * keep every case real-browser, real-navigation, and network-free.
 */
describe("executePlan", () => {
  it("navigate + find: locates a real element and produces two Observations", async () => {
    const plan: Plan = [
      { action: "navigate", target: "data:text/html,<button>Cadastro</button>" },
      { action: "find", target: "botão de cadastro" },
    ];

    const observations = await executePlan(plan);

    expect(observations).toHaveLength(2);
    expect(observations[0].evidence).toContain("page.goto(");
    expect(observations[1].observed).toBe('An element matching "botão de cadastro" was found on the page.');
    expect(observations[1].evidence).toContain("-> true.");
  });

  it("navigate + find on a page without the element: reports absence, never invents presence", async () => {
    const plan: Plan = [
      { action: "navigate", target: "data:text/html,<p>NadaAqui</p>" },
      { action: "find", target: "botão de cadastro" },
    ];

    const observations = await executePlan(plan);

    expect(observations).toHaveLength(2);
    expect(observations[1].observed).toBe('No element matching "botão de cadastro" was found on the page.');
    expect(observations[1].evidence).toContain("-> false.");
  });

  it("navigate + click: executes a real click and produces an Observation", async () => {
    const plan: Plan = [
      { action: "navigate", target: 'data:text/html,<button id="ok">OK</button>' },
      { action: "click", target: "#ok" },
    ];

    const observations = await executePlan(plan);

    expect(observations).toHaveLength(2);
    expect(observations[1].observed).toBe('Clicked "#ok" without error.');
  });

  it("navigate + fill + getText: fills a real field and reads the real value back", async () => {
    const plan: Plan = [
      { action: "navigate", target: 'data:text/html,<input id="name" />' },
      { action: "fill", target: "#name", value: "Ada Lovelace" },
      { action: "getText", target: "#name" },
    ];

    const observations = await executePlan(plan);

    expect(observations).toHaveLength(3);
    expect(observations[1].observed).toBe('The field now reads "Ada Lovelace".');
    expect(observations[2].observed).toBe('"#name" contains: "Ada Lovelace".');
  });

  it("a real navigation failure rejects instead of producing a fabricated Observation", async () => {
    const plan: Plan = [
      { action: "navigate", target: "http://127.0.0.1:1" },
      { action: "find", target: "botão de cadastro" },
    ];

    await expect(executePlan(plan)).rejects.toThrow();
  });

  describe("controlled 3-step sequence: navigate → click → find (button/link only — no selector evolution)", () => {
    // "Continuar" doesn't exist until "Entrar" is clicked — real, observable
    // dynamic behavior. Both are real <button> elements, so
    // buildElementSelector("botão Continuar") already resolves them today
    // (role=button[name=/Continuar/i]) — no new element type involved.
    const DATA_URL =
      'data:text/html,<button id="entrar" onclick="document.getElementById(\'slot\').innerHTML=\'<button>Continuar</button>\'">Entrar</button><div id="slot"></div>';

    it("navigate, click and find all execute for real and produce 3 honest Observations", async () => {
      const plan: Plan = [
        { action: "navigate", target: DATA_URL },
        { action: "click", target: "#entrar" },
        { action: "find", target: "botão Continuar" },
      ];

      const observations = await executePlan(plan);

      expect(observations).toHaveLength(3); // 5. exactly 3 Observations

      // 1. the page was really opened.
      expect(observations[0].observed).toContain("bytes of real HTML");
      expect(observations[0].evidence).toContain("page.goto(");

      // 2. the click really happened.
      expect(observations[1].observed).toBe('Clicked "#entrar" without error.');
      expect(observations[1].evidence).toBe('adapter.click("#entrar") resolved without error.');

      // 4. find really resolved "botão Continuar" via buildElementSelector()
      // (role=button[name=/Continuar/i], the same mapping check-element-exists
      // already uses — nothing new) and found it for real.
      expect(observations[2].action).toContain("role=button[name=/Continuar/i]");
      expect(observations[2].observed).toBe('An element matching "botão Continuar" was found on the page.');
      expect(observations[2].evidence).toBe('exists("role=button[name=/Continuar/i]") -> true.');
    });

    it("3. independently of executePlan(): 'Continuar' really doesn't exist before the click and really does after", async () => {
      // A direct BrowserAdapter check, not a change to executePlan() —
      // proves the DOM change itself, isolated from the find/selector step.
      const adapter = await launchBrowserAdapter(DATA_URL);
      try {
        await adapter.navigate(DATA_URL);
        expect(await adapter.exists("role=button[name=/Continuar/i]")).toBe(false);
        await adapter.click("#entrar");
        expect(await adapter.exists("role=button[name=/Continuar/i]")).toBe(true);
      } finally {
        await adapter.close();
      }
    });
  });
});

describe("recognizePlan", () => {
  it("recognizes the supported sentence and produces the exact expected Plan", () => {
    const plan = recognizePlan("Abra https://exemplo.com e verifique se existe um botão de cadastro.");

    expect(plan).toEqual([
      { action: "navigate", target: "https://exemplo.com" },
      { action: "find", target: "um botão de cadastro" },
    ]);
  });

  it("extracts the URL correctly", () => {
    const plan = recognizePlan("Abra https://outro-exemplo.com/pagina e verifique se existe um link.");
    expect(plan?.[0]).toEqual({ action: "navigate", target: "https://outro-exemplo.com/pagina" });
  });

  it("preserves the element description exactly as written, unstripped", () => {
    const plan = recognizePlan("Abra https://exemplo.com e verifique se existe um botão de cadastro.");
    expect(plan?.[1]).toEqual({ action: "find", target: "um botão de cadastro" });
  });

  it("an explicit url parameter overrides the one written in the sentence, never invents one", () => {
    const plan = recognizePlan(
      "Abra https://exemplo.com e verifique se existe um botão de cadastro.",
      "https://outra-url.com",
    );
    expect(plan?.[0]).toEqual({ action: "navigate", target: "https://outra-url.com" });
  });

  it("returns null for sentences that don't match the supported pattern", () => {
    expect(recognizePlan("Abra https://exemplo.com")).toBeNull();
    expect(recognizePlan("Verifique se existe um botão de cadastro.")).toBeNull();
    expect(recognizePlan("Crie um projeto chamado Taka.")).toBeNull();
  });

  it("end-to-end: recognizePlan() + executePlan() produce real browser evidence", async () => {
    const plan = recognizePlan(
      "Abra data:text/html,<button>Cadastro</button> e verifique se existe um botão de cadastro.",
    );
    expect(plan).not.toBeNull();

    const observations = await executePlan(plan!);

    expect(observations).toHaveLength(2);
    expect(observations[1].observed).toBe('An element matching "um botão de cadastro" was found on the page.');
    expect(observations[1].evidence).toContain("-> true.");
  });
});
