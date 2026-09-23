import { z } from "zod";

/** The three modes every project runs in — see docs/PRODUCT_VISION.md. */
export const PROJECT_MODES = ["INTERNAL", "PRODUCT", "HYBRID"] as const;
export type ProjectMode = (typeof PROJECT_MODES)[number];

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(500).optional(),
  mode: z.enum(PROJECT_MODES).default("HYBRID"),
});

// z.input (not z.infer/z.output) so callers can omit `mode` and get the
// schema's default — z.infer would require it since it reflects the
// post-default output shape.
export type CreateProjectInput = z.input<typeof createProjectSchema>;
