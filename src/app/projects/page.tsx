import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";
import { listProjects } from "@/services/projects";
import { CreateProjectForm } from "@/app/projects/create-project-form";

export default async function ProjectsPage() {
  const projects = await listProjects();

  return (
    <>
      <PageHeader title="Projects" description="Products and projects registered in the lab." />
      <div className="grid grid-cols-1 gap-8 px-8 py-8 lg:grid-cols-[1fr_320px]">
        <div>
          {projects.length === 0 ? (
            <EmptyState
              title="No projects yet"
              description="Create your first project using the form to get started."
            />
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {projects.map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/projects/${project.id}`}
                    className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-foreground/[0.04]"
                  >
                    <div>
                      <p className="text-sm font-medium">{project.name}</p>
                      {project.description ? (
                        <p className="mt-0.5 text-sm text-muted">{project.description}</p>
                      ) : null}
                    </div>
                    <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted">
                      {project.mode}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <CreateProjectForm />
      </div>
    </>
  );
}
