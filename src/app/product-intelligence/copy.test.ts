import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const piPage = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");
const recommendationDetailPage = readFileSync(
  fileURLToPath(new URL("./recommendations/[id]/page.tsx", import.meta.url)),
  "utf-8",
);
const testLabPage = readFileSync(fileURLToPath(new URL("../test-lab/page.tsx", import.meta.url)), "utf-8");
const implementationTaskPage = readFileSync(
  fileURLToPath(new URL("./recommendations/[id]/task/page.tsx", import.meta.url)),
  "utf-8",
);

describe("Product Intelligence page copy", () => {
  it("has a Nova avaliação CTA that leads to the existing Evaluation Mission flow", () => {
    expect(piPage).toMatch(/Nova avaliação/);
    expect(piPage).toContain("/test-lab#evaluation-mission");
  });

  it("never labels approving a recommendation as Executar (reserved for actions that really execute something)", () => {
    expect(piPage).not.toMatch(/>\s*Executar\s*</);
    expect(recommendationDetailPage).not.toMatch(/>\s*Executar\s*</);
    expect(piPage).toMatch(/Aprovar recomendação/);
    expect(recommendationDetailPage).toMatch(/Aprovar recomendação/);
  });

  it("has a Histórico section whose action reuses the existing Mission page (no second report page)", () => {
    expect(piPage).toMatch(/Histórico/);
    expect(piPage).toMatch(/Ver avaliação/);
    expect(piPage).toContain("/test-lab/missions/${run.id}");
  });

  it("offers a Ver tarefa de implementação action once a recommendation is approved, in both the list and the detail page", () => {
    expect(piPage).toMatch(/Ver tarefa de implementação/);
    expect(recommendationDetailPage).toMatch(/Ver tarefa de implementação/);
    expect(piPage).toContain("/task");
    expect(recommendationDetailPage).toContain("/task");
  });
});

describe("Implementation Task page", () => {
  it("only ever renders for an APPROVED recommendation — IGNORED/PENDING must never produce a task", () => {
    expect(implementationTaskPage).toMatch(/recommendation\.status !== "APPROVED"/);
    expect(implementationTaskPage).toMatch(/notFound\(\)/);
  });

  it("offers a Copiar tarefa action to copy the full task to the clipboard", () => {
    expect(implementationTaskPage).toMatch(/CopyTaskButton/);
  });

  it("never claims the LAB executed the change — only that it derived a task", () => {
    expect(implementationTaskPage).not.toMatch(/o LAB executa|foi implementado automaticamente/i);
    expect(implementationTaskPage).toMatch(/não executa/i);
  });
});

describe("Test Lab page copy", () => {
  it("no longer claims only New User, QA and UX participate in an Evaluation Mission", () => {
    expect(testLabPage).not.toMatch(/New User,\s*QA/);
  });

  it("exposes an anchor the Evaluation Mission CTA can link to", () => {
    expect(testLabPage).toContain('id="evaluation-mission"');
  });
});
