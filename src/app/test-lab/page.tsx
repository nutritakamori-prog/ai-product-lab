import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { listScenarios, listTestRuns, getScenarioName } from "@/services/test-lab";

export const dynamic = "force-dynamic";

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "—";
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export default async function TestLabPage() {
  const [scenarios, testRuns] = await Promise.all([listScenarios(), listTestRuns()]);

  return (
    <>
      <PageHeader
        title="Test Lab"
        description="Structured scenarios agents use to test the LAB itself, and the runs that resulted from them."
      />
      <div className="flex flex-col gap-8 px-8 py-8">
        <section>
          <p className="text-sm font-medium">Scenarios</p>
          <div className="mt-3">
            {scenarios.length === 0 ? (
              <EmptyState
                title="No scenarios yet"
                description="Scenarios are versioned files under src/core/testing/scenarios — none exist yet."
              />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {scenarios.map((scenario) => (
                  <li key={scenario.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">{scenario.name}</p>
                      <p className="mt-0.5 text-sm text-muted">{scenario.description}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted">
                        {scenario.category}
                      </span>
                      <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted">
                        {scenario.priority}
                      </span>
                      <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted">
                        {scenario.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section>
          <p className="text-sm font-medium">Test Runs</p>
          <div className="mt-3">
            {testRuns.length === 0 ? (
              <EmptyState
                title="No test runs yet"
                description="A test run is recorded when a scenario is actually executed against the app. None have run outside of automated tests yet."
              />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {testRuns.map((testRun) => (
                  <li key={testRun.id}>
                    <Link
                      href={`/test-lab/runs/${testRun.id}`}
                      className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-foreground/[0.04]"
                    >
                      <div>
                        <p className="text-sm font-medium">{getScenarioName(testRun.scenarioId)}</p>
                        <p className="mt-0.5 text-sm text-muted">
                          {testRun.agent.slug} · {testRun.createdAt.toLocaleString("en-US")}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-muted">{formatDuration(testRun.durationMs)}</span>
                        <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted">
                          {testRun.status}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
