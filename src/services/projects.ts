import { db } from "@/lib/db";
import { createProjectSchema, type CreateProjectInput } from "@/domain/project";
import { getDefaultOrganization } from "@/services/organizations";
import { recordAuditLog } from "@/services/audit-log";

export async function listProjects() {
  const organization = await getDefaultOrganization();
  return db.project.findMany({
    where: { organizationId: organization.id },
    orderBy: { createdAt: "desc" },
  });
}

export async function createProject(input: CreateProjectInput) {
  const data = createProjectSchema.parse(input);
  const organization = await getDefaultOrganization();

  const project = await db.project.create({
    data: {
      organizationId: organization.id,
      name: data.name,
      description: data.description,
      mode: data.mode,
    },
  });

  await recordAuditLog({
    organizationId: organization.id,
    action: "project.created",
    entityType: "Project",
    entityId: project.id,
    metadata: { name: project.name, mode: project.mode },
  });

  return project;
}
