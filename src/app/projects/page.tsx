import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/button";

export const dynamic = "force-dynamic";
import { listProjects } from "@/services/projects";
import { PROJECT_MODES } from "@/domain/project";
import { createProjectAction } from "@/app/projects/actions";

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
                <li key={project.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{project.name}</p>
                    {project.description ? (
                      <p className="mt-0.5 text-sm text-muted">{project.description}</p>
                    ) : null}
                  </div>
                  <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted">
                    {project.mode}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form action={createProjectAction} className="h-fit rounded-lg border border-border p-5">
          <p className="text-sm font-medium">New project</p>
          <div className="mt-4 flex flex-col gap-3">
            <div>
              <label htmlFor="name" className="text-xs text-muted">
                Name
              </label>
              <input
                id="name"
                name="name"
                required
                maxLength={120}
                className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent"
                placeholder="e.g. Onboarding flow"
              />
            </div>
            <div>
              <label htmlFor="description" className="text-xs text-muted">
                Description
              </label>
              <textarea
                id="description"
                name="description"
                maxLength={500}
                rows={2}
                className="mt-1 w-full resize-none rounded-md border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent"
                placeholder="Optional"
              />
            </div>
            <div>
              <label htmlFor="mode" className="text-xs text-muted">
                Mode
              </label>
              <select
                id="mode"
                name="mode"
                defaultValue="HYBRID"
                className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent"
              >
                {PROJECT_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" className="mt-1 w-full">
              Create project
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
