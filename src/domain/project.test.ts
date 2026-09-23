import { describe, expect, it } from "vitest";
import { createProjectSchema } from "./project";

describe("createProjectSchema", () => {
  it("accepts a minimal valid input and defaults mode to HYBRID", () => {
    const result = createProjectSchema.parse({ name: "Onboarding flow" });
    expect(result).toEqual({ name: "Onboarding flow", mode: "HYBRID" });
  });

  it("trims whitespace from name and description", () => {
    const result = createProjectSchema.parse({
      name: "  Checkout  ",
      description: "  Reduce drop-off  ",
    });
    expect(result.name).toBe("Checkout");
    expect(result.description).toBe("Reduce drop-off");
  });

  it("rejects an empty name", () => {
    expect(() => createProjectSchema.parse({ name: "" })).toThrow();
  });

  it("rejects an invalid mode", () => {
    expect(() => createProjectSchema.parse({ name: "x", mode: "WRONG" })).toThrow();
  });
});
