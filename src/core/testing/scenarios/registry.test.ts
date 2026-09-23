import { describe, expect, it } from "vitest";
import { ScenarioRegistry } from "./registry";

describe("ScenarioRegistry", () => {
  it("discovers both real scenarios", () => {
    expect(ScenarioRegistry.discoverIds()).toContain("new-user-creates-first-project");
    expect(ScenarioRegistry.discoverIds()).toContain("new-user-discovers-and-creates-first-project");
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
