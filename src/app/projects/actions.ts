"use server";

import { revalidatePath } from "next/cache";
import { createProject } from "@/services/projects";
import type { ProjectMode } from "@/domain/project";

export interface CreateProjectActionState {
  /** The just-created project's own name — set only on a successful submission, so the form can show an explicit confirmation instead of leaving the user to notice the list changed on their own. */
  createdName: string | null;
  error: string | null;
}

/**
 * Same useActionState shape RunTaskForm/EvaluationMissionForm already use
 * (see src/app/test-lab/actions.ts) — applied here so a project creation
 * gets the same explicit success/error feedback those flows already have,
 * instead of a plain fire-and-forget form action with no result at all.
 */
export async function createProjectAction(
  _prevState: CreateProjectActionState,
  formData: FormData,
): Promise<CreateProjectActionState> {
  try {
    const project = await createProject({
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? "") || undefined,
      mode: (String(formData.get("mode") ?? "HYBRID") as ProjectMode) || "HYBRID",
    });

    revalidatePath("/projects");
    revalidatePath("/");

    return { createdName: project.name, error: null };
  } catch (err) {
    return { createdName: null, error: err instanceof Error ? err.message : String(err) };
  }
}
