import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { listProjects } from "@/services/projects";
import { listAgents, countAgentExecutions } from "@/services/agents";

// Always read live data — this page has nothing worth statically caching yet.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [projects, agents] = await Promise.all([listProjects(), listAgents()]);
  const enabledAgents = agents.filter((agent) => agent.enabled).length;
  const agentExecutionCount = await countAgentExecutions(projects.map((project) => project.id));

  // Computed from the real AgentExecution count (see services/agents.ts),
  // never a fixed sentence — the "no agent has run yet" wording stays
  // correct because it's now conditional on that count actually being zero,
  // instead of always being shown regardless of real activity.
  const description =
    agentExecutionCount > 0
      ? `${agentExecutionCount} agent execution${agentExecutionCount === 1 ? "" : "s"} recorded so far.`
      : "AI Product Lab is in its foundation phase — no agent has run yet.";

  const stats = [
    { label: "Projects", value: projects.length, href: "/projects" },
    { label: "Agents configured", value: agents.length, href: "/agents" },
    { label: "Agents enabled", value: enabledAgents, href: "/agents" },
  ];

  return (
    <>
      <PageHeader title="Dashboard" description={description} />
      <div className="px-8 py-8">
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
          {stats.map((stat) => (
            <Link
              key={stat.label}
              href={stat.href}
              className="bg-background px-5 py-5 transition-colors hover:bg-foreground/[0.04]"
            >
              <p className="text-2xl font-semibold tracking-tight">{stat.value}</p>
              <p className="mt-1 text-sm text-muted">{stat.label}</p>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
