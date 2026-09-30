import { describe, expect, it } from "vitest";
import { recognizeIntent } from "./task-intents";

describe("recognizeIntent", () => {
  it("recognizes a create-project task and extracts the name", () => {
    const intent = recognizeIntent("Crie um projeto novo chamado Teste LAB");
    expect(intent).toEqual({ intent: "create-project", projectName: "Teste LAB" });
  });

  it("extracts the name correctly even with different phrasing", () => {
    const intent = recognizeIntent("Criar um novo projeto com o nome Onboarding Flow.");
    expect(intent).toEqual({ intent: "create-project", projectName: "Onboarding Flow" });
  });

  it("returns null for an unrecognized task — no intent is invented", () => {
    expect(recognizeIntent("Avalie o onboarding de um novo usuário no app.")).toBeNull();
  });

  it("recognizes a verify-project-exists task and extracts the name, across the accepted phrasings", () => {
    for (const task of [
      "Verifique se o projeto Teste LAB existe",
      "Verificar se o projeto Teste LAB existe",
      "Confira se o projeto Teste LAB existe.",
    ]) {
      expect(recognizeIntent(task)).toEqual({ intent: "verify-project-exists", projectName: "Teste LAB" });
    }
  });

  it("recognizes a check-element-exists task and extracts the URL and element description", () => {
    const intent = recognizeIntent("Abra https://exemplo.com e verifique se existe um botão de cadastro.");
    expect(intent).toEqual({
      intent: "check-element-exists",
      url: "https://exemplo.com",
      elementDescription: "um botão de cadastro",
    });
  });

  it("returns null for check-element-exists when the sentence doesn't fully match the pattern", () => {
    // No "e verifique se existe" clause — must not be mistaken for this intent.
    expect(recognizeIntent("Abra https://exemplo.com")).toBeNull();
  });
});
