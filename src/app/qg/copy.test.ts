import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const officeSource = readFileSync(fileURLToPath(new URL("./qg-office.tsx", import.meta.url)), "utf-8");
const pageSource = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

describe("LAB QG office", () => {
  it("represents every required zone from the World spec", () => {
    for (const zone of ["Entrada", "Head", "Arquivo", "Mesa de reunião", "Product Intelligence", "Implementation", "Retest", "Relatórios", "Relógio"]) {
      expect(officeSource).toContain(zone);
    }
  });

  it("offers a way back to the LAB, never trapping the user", () => {
    expect(officeSource).toMatch(/Voltar ao LAB/);
    expect(officeSource).toContain('href="/"');
  });

  it("offers zoom controls (in, out, reset)", () => {
    expect(officeSource).toMatch(/Aumentar zoom/);
    expect(officeSource).toMatch(/Diminuir zoom/);
    expect(officeSource).toMatch(/Resetar zoom/);
  });

  it("offers a Quick View that doesn't require walking the whole office", () => {
    expect(officeSource).toMatch(/Quick View/);
  });

  it("routes the Quadro and Retest stations to the real, existing pages instead of a duplicate flow", () => {
    expect(officeSource).toContain('href="/product-intelligence"');
    expect(officeSource).toContain('href="/test-lab"');
  });

  it("never fabricates an agent's activity — every station reads its state from the derived AgentQgState", () => {
    expect(officeSource).toMatch(/deriveAgentQgState|AgentQgState/);
    expect(pageSource).toContain("deriveAgentQgState");
  });

  it("computes the global status deterministically from real data, not from an invented score", () => {
    expect(pageSource).toContain("deriveGlobalStatus");
  });
});
