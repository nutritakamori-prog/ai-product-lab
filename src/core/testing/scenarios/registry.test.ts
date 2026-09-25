import { describe, expect, it } from "vitest";
import { ScenarioRegistry } from "./registry";

describe("ScenarioRegistry", () => {
  it("discovers all eight real scenarios", () => {
    expect(ScenarioRegistry.discoverIds()).toContain("new-user-creates-first-project");
    expect(ScenarioRegistry.discoverIds()).toContain("new-user-discovers-and-creates-first-project");
    expect(ScenarioRegistry.discoverIds()).toContain("new-user-explores-agents-area");
    expect(ScenarioRegistry.discoverIds()).toContain("new-user-explores-settings");
    expect(ScenarioRegistry.discoverIds()).toContain("new-user-submits-empty-project-name");
    expect(ScenarioRegistry.discoverIds()).toContain("new-user-creates-project-and-returns-to-list");
    expect(ScenarioRegistry.discoverIds()).toContain("qa-agent-validates-empty-project-name-submission");
    expect(ScenarioRegistry.discoverIds()).toContain("qa-agent-verifies-project-persistence-after-creation");
  });

  it("loads a known scenario by id", () => {
    const scenario = ScenarioRegistry.getById("new-user-creates-first-project");
    expect(scenario).not.toBeNull();
    expect(scenario?.name).toBe("Novo usuário cria seu primeiro projeto");
    expect(scenario?.enabled).toBe(true);
    expect(scenario?.steps.length).toBeGreaterThan(0);
  });

  it("loads the discoverability scenario by id", () => {
    const scenario = ScenarioRegistry.getById("new-user-discovers-and-creates-first-project");
    expect(scenario).not.toBeNull();
    expect(scenario?.name).toBe("Novo usuário encontra e cria seu primeiro projeto sem ajuda");
    expect(scenario?.enabled).toBe(true);
    expect(scenario?.category).toBe("onboarding");
    expect(scenario?.steps.length).toBeGreaterThan(0);
  });

  it("loads the Agents-area exploration scenario by id", () => {
    const scenario = ScenarioRegistry.getById("new-user-explores-agents-area");
    expect(scenario).not.toBeNull();
    expect(scenario?.name).toBe("Novo usuário explora a área de Agents");
    expect(scenario?.enabled).toBe(true);
    expect(scenario?.category).toBe("agents");
    expect(scenario?.agent).toBe("new-user");
    expect(scenario?.steps.length).toBeGreaterThan(0);
  });

  it("loads the Settings-area exploration scenario by id", () => {
    const scenario = ScenarioRegistry.getById("new-user-explores-settings");
    expect(scenario).not.toBeNull();
    expect(scenario?.name).toBe("Novo usuário explora a área de Settings");
    expect(scenario?.enabled).toBe(true);
    expect(scenario?.category).toBe("settings");
    expect(scenario?.agent).toBe("new-user");
    expect(scenario?.steps.length).toBeGreaterThan(0);
  });

  it("loads the empty-name submission scenario by id", () => {
    const scenario = ScenarioRegistry.getById("new-user-submits-empty-project-name");
    expect(scenario).not.toBeNull();
    expect(scenario?.name).toBe("Novo usuário tenta criar um projeto sem preencher o nome");
    expect(scenario?.enabled).toBe(true);
    expect(scenario?.category).toBe("functional");
    expect(scenario?.priority).toBe("HIGH");
    expect(scenario?.agent).toBe("new-user");
    expect(scenario?.steps.length).toBeGreaterThan(0);
  });

  it("loads the create-and-return-to-list scenario by id", () => {
    const scenario = ScenarioRegistry.getById("new-user-creates-project-and-returns-to-list");
    expect(scenario).not.toBeNull();
    expect(scenario?.name).toBe("Novo usuário cria um projeto e retorna à lista de Projects");
    expect(scenario?.enabled).toBe(true);
    expect(scenario?.category).toBe("project-management");
    expect(scenario?.priority).toBe("HIGH");
    expect(scenario?.agent).toBe("new-user");
    expect(scenario?.steps.length).toBeGreaterThan(0);
  });

  it("loads the qa-agent empty-name validation scenario by id", () => {
    const scenario = ScenarioRegistry.getById("qa-agent-validates-empty-project-name-submission");
    expect(scenario).not.toBeNull();
    expect(scenario?.name).toBe("QA verifica bloqueio de submissão de projeto sem nome");
    expect(scenario?.enabled).toBe(true);
    expect(scenario?.category).toBe("functional");
    expect(scenario?.priority).toBe("HIGH");
    expect(scenario?.agent).toBe("qa-agent");
    expect(scenario?.steps.length).toBeGreaterThan(0);
  });

  it("loads the qa-agent project-persistence scenario by id", () => {
    const scenario = ScenarioRegistry.getById("qa-agent-verifies-project-persistence-after-creation");
    expect(scenario).not.toBeNull();
    expect(scenario?.name).toBe("QA verifica persistência de projeto após criação");
    expect(scenario?.enabled).toBe(true);
    expect(scenario?.category).toBe("project-management");
    expect(scenario?.priority).toBe("HIGH");
    expect(scenario?.agent).toBe("qa-agent");
    expect(scenario?.steps.length).toBeGreaterThan(0);
  });

  it("returns null for an unknown scenario id", () => {
    expect(ScenarioRegistry.getById("does-not-exist")).toBeNull();
  });

  it("listEnabled only returns enabled scenarios", () => {
    const enabled = ScenarioRegistry.listEnabled();
    expect(enabled.every((scenario) => scenario.enabled)).toBe(true);
  });

  it("list returns every known scenario", () => {
    expect(ScenarioRegistry.list().map((scenario) => scenario.id)).toEqual(ScenarioRegistry.discoverIds());
  });
});
