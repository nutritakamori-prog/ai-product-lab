import { PageHeader } from "@/components/page-header";
import { listProjects } from "@/services/projects";
import { listAgents } from "@/services/agents";

// Always read live data — this page has nothing worth statically caching yet.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [projects, agents] = await Promise.all([listProjects(), listAgents()]);
  const enabledAgents = agents.filter((agent) => agent.enabled).length;

  const stats = [
    { label: "Projects", value: projects.length },
    { label: "Agents configured", value: agents.length },
    { label: "Agents enabled", value: enabledAgents },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="AI Product Lab is in its foundation phase — no agent has run yet."
      />
      <div className="px-8 py-8">
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
          {stats.map((stat) => (
            <div key={stat.label} className="bg-background px-5 py-5">
              <p className="text-2xl font-semibold tracking-tight">{stat.value}</p>
              <p className="mt-1 text-sm text-muted">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
