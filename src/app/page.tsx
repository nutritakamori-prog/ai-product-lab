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
  // instead of always being shown regardless of real activity. The leading
  // sentence is the one fixed part: a first-time visitor landing here has no
  // other cue on this page for what the LAB even is (Recommendation
  // cmuo9qnvl0008167dws78elj1) — kept to one short sentence plus a next
  // step, never a full explainer.
  const activitySummary =
    agentExecutionCount > 0
      ? `${agentExecutionCount} agent execution${agentExecutionCount === 1 ? "" : "s"} recorded so far.`
      : "No agent has run yet.";
  // "Start by opening Projects below" implied an openable list sitting
  // right under it; what's actually there is just the Projects count tile
  // (Recommendation cmuujbic600085p7d2xjl83xv, FASE 17's real E2E).
  //
  // The product's own trust guarantee (a human reviews every recommendation
  // before anything is implemented) was invisible on this page — a visitor
  // reading only "turns findings into recommendations" has no reason to
  // assume a human stays in control (Recommendation cmuv3xgvh0008227duo8v3nl8,
  // FINAL VALIDATION's own real E2E, product-agent finding).
  const description = `AI Product Lab is where a team of specialist agents evaluates real products and turns findings into recommendations a human reviews and decides on. ${activitySummary} See your projects below.`;

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
        {/* Recommendation cmuv3xgvh0009227d4z04ejmz (FINAL VALIDATION, ux-agent
            finding) asked for some signal of pending decisions on this page.
            This is a static pointer to /qg only, never a real pending count —
            computing that here would be a bigger change than this fix is
            meant to be. */}
        <Link href="/qg" className="mt-4 inline-block text-sm text-muted underline-offset-4 hover:underline">
          Pending decisions → /qg
        </Link>
      </div>
    </>
  );
}
