import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { getProject } from "@/services/projects";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <>
      <PageHeader title={project.name} description={project.description ?? "No description."} />
      <div className="flex flex-col gap-8 px-8 py-8">
        <section>
          <p className="text-sm font-medium">Project</p>
          <dl className="mt-3 divide-y divide-border rounded-lg border border-border">
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted">Name</dt>
              <dd className="text-sm font-medium">{project.name}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted">Description</dt>
              <dd className="text-sm font-medium">{project.description ?? "—"}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted">Mode</dt>
              <dd className="text-sm font-medium">{project.mode}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted">Created</dt>
              <dd className="text-sm font-medium">{project.createdAt.toLocaleString("en-US")}</dd>
            </div>
          </dl>
        </section>
      </div>
    </>
  );
}
