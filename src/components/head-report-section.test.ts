import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./head-report-section.tsx", import.meta.url)), "utf-8");

describe("HeadReportSection copy", () => {
  it("always explains what 'Head' means, regardless of whether a headReport exists for the run", () => {
    expect(source).toMatch(/Head — a síntese da equipe sobre esta avaliação/);
  });
});
