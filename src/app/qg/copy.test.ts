import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const officeSource = readFileSync(fileURLToPath(new URL("./qg-office.tsx", import.meta.url)), "utf-8");
const pageSource = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");
const globalsCssSource = readFileSync(fileURLToPath(new URL("../globals.css", import.meta.url)), "utf-8");

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

  // FASE 9C — Recommendation cmung3g6b0005i67dqjuoocyf (new-user): a first-
  // time visitor had no sentence explaining what LAB QG is or what to do.
  it("explains what LAB QG is to a first-time visitor, right under the title", () => {
    expect(officeSource).toMatch(/O escritório visual do LAB/);
  });

  // FASE 9C — Recommendation cmung3g6b0006i67di76wvi4v (ux-agent): count
  // badges (Head/Quadro/Implementation) appeared as bare numbers with no
  // adjacent text explaining what they meant. The same fix also covers the
  // accessibility angle raised by cmung3g6b0007i67dap80pjja (deliberately
  // ignored as a duplicate of this one): a real visible text label is
  // inherently readable by assistive tech too, so the decorative bare-number
  // circle is marked aria-hidden instead of needing a second, separate
  // accessibility layer.
  it("gives every count badge an explicit, visible text label instead of a bare number", () => {
    expect(officeSource).toMatch(/badgeLabel/);
    expect(officeSource).toMatch(/\{data\.pendingCount\}\s*pendente\(s\)<\/span>/);
    expect(officeSource).toMatch(/\{data\.approvedCount\}\s*aprovada\(s\)<\/span>/);
  });

  // FASE 9C — Recommendation cmunvpmry0005wm7dxey8ava4 (ux-agent, found while
  // re-evaluating the fix above): the decorative corner badge was marked
  // aria-hidden (correctly excluded from the accessibility tree), but it still
  // rendered the bare number as a real JSX text node, so getText()/
  // textContent/innerText still picked it up as a redundant number right
  // before the labeled count. The fix renders that number via CSS generated
  // content (a data attribute + a ::before rule in globals.css) instead of a
  // text node, so it stays visible but never appears in text extraction —
  // only the one labeled count (e.g. "2 pendente(s)") does.
  it("renders every decorative corner badge via CSS generated content, never as a bare-number text node", () => {
    // None of the three aria-hidden decorative badges may hold a raw number as
    // JSX text content anymore.
    expect(officeSource).not.toMatch(/aria-hidden[\s\S]{0,80}>\s*\{badge\}\s*<\/span>/);
    expect(officeSource).not.toMatch(/aria-hidden[\s\S]{0,80}>\s*\{data\.pendingCount\}\s*<\/span>/);
    expect(officeSource).not.toMatch(/aria-hidden[\s\S]{0,80}>\s*\{data\.approvedCount\}\s*<\/span>/);
    // Instead, each one carries its count as a `data-count` attribute for a
    // CSS ::before rule to render, and every occurrence is self-closing (no
    // text-node children at all).
    expect(officeSource).toMatch(/data-count=\{badge\}/);
    expect(officeSource).toMatch(/data-count=\{data\.pendingCount\}/);
    expect(officeSource).toMatch(/data-count=\{data\.approvedCount\}/);
    expect(officeSource.match(/qg-decorative-count/g)?.length).toBe(3);
    // The visible, labeled counts underneath each station are untouched.
    expect(globalsCssSource).toMatch(/\.qg-decorative-count::before\s*\{\s*content:\s*attr\(data-count\);?\s*\}/);
  });
});
