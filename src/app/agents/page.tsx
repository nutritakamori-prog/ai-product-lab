import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { listAgents } from "@/services/agents";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const agents = await listAgents();

  return (
    <>
      <PageHeader
        title="Agents"
        description="The agent library. Most categories are still empty — Phase 5 fills them in one reviewed agent at a time."
      />
      <div className="px-8 py-8">
        {agents.length === 0 ? (
          <EmptyState
            title="No agents configured yet"
            description="Experience, QA, Design, and Strategy agents are added in Phase 5, each with its own reviewed system prompt — not seeded in bulk ahead of time."
          />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {agents.map((agent) => (
              <li key={agent.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{agent.name}</p>
                  <p className="mt-0.5 text-sm text-muted">{agent.objective}</p>
                </div>
                <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted">
                  {agent.enabled ? "Enabled" : "Disabled"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
