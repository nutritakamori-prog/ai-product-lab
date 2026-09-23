"use server";

import { revalidatePath } from "next/cache";
import { createProject } from "@/services/projects";
import type { ProjectMode } from "@/domain/project";

export async function createProjectAction(formData: FormData) {
  await createProject({
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? "") || undefined,
    mode: (String(formData.get("mode") ?? "HYBRID") as ProjectMode) || "HYBRID",
  });

  revalidatePath("/projects");
  revalidatePath("/");
}
