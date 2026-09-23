import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { getTestRun, getScenarioName } from "@/services/test-lab";
import type { Observation } from "@/core/testing/runner/test-runner";
import type { AgentOutput } from "@/domain/agent-output";

export const dynamic = "force-dynamic";

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "—";
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export default async function TestRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const testRun = await getTestRun(id);
  if (!testRun) notFound();

  // Written by runTestScenario using exactly these shapes — see
  // src/core/testing/runner/test-runner.ts. Cast defensively rather than
  // trusting an untyped Json column blindly.
  const observations = (testRun.observations as unknown as Observation[] | null) ?? [];
  const findings = (testRun.findings as unknown as AgentOutput[] | null) ?? [];

  return (
    <>
      <PageHeader
        title={getScenarioName(testRun.scenarioId)}
        description={`${testRun.agent.slug} · ${testRun.status}`}
      />
      <div className="flex flex-col gap-8 px-8 py-8">
        <section>
          <p className="text-sm font-medium">Run</p>
          <dl className="mt-3 divide-y divide-border rounded-lg border border-border">
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted">Scenario</dt>
              <dd className="text-sm font-medium">{getScenarioName(testRun.scenarioId)}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted">Agent</dt>
              <dd className="text-sm font-medium">{testRun.agent.slug}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted">Status</dt>
              <dd className="text-sm font-medium">{testRun.status}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-muted">Duration</dt>
              <dd className="text-sm font-medium">{formatDuration(testRun.durationMs)}</dd>
            </div>
            {testRun.execution ? (
              <>
                <div className="flex items-center justify-between px-4 py-3">
                  <dt className="text-sm text-muted">Model</dt>
                  <dd className="text-sm font-medium">{testRun.execution.model ?? "—"}</dd>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <dt className="text-sm text-muted">Token usage</dt>
                  <dd className="text-sm font-medium">
                    {testRun.execution.inputTokens ?? "—"} in / {testRun.execution.outputTokens ?? "—"} out
                  </dd>
                </div>
              </>
            ) : null}
          </dl>
        </section>

        <section>
          <p className="text-sm font-medium">Observations</p>
          {observations.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No observations were recorded for this run.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
              {observations.map((observation, index) => (
                <li key={index} className="px-4 py-3">
                  <p className="text-sm font-medium">
                    Step {index + 1}: {observation.action}
                  </p>
                  <dl className="mt-2 flex flex-col gap-1">
                    <div className="flex gap-2 text-sm">
                      <dt className="w-20 shrink-0 text-muted">Expected</dt>
                      <dd>{observation.expected}</dd>
                    </div>
                    <div className="flex gap-2 text-sm">
                      <dt className="w-20 shrink-0 text-muted">Observed</dt>
                      <dd>{observation.observed}</dd>
                    </div>
                    <div className="flex gap-2 text-sm">
                      <dt className="w-20 shrink-0 text-muted">Evidence</dt>
                      <dd className="text-muted">{observation.evidence}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <p className="text-sm font-medium">Findings</p>
          {findings.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No findings were recorded for this run.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
              {findings.map((finding, index) => (
                <li key={index} className="px-4 py-3">
                  <p className="text-sm font-medium">{finding.finding ?? finding.status}</p>
                  <dl className="mt-2 flex flex-col gap-1">
                    <div className="flex gap-2 text-sm">
                      <dt className="w-28 shrink-0 text-muted">Impact</dt>
                      <dd>{finding.impact ?? "—"}</dd>
                    </div>
                    <div className="flex gap-2 text-sm">
                      <dt className="w-28 shrink-0 text-muted">Recommendation</dt>
                      <dd>{finding.recommendation ?? "—"}</dd>
                    </div>
                    <div className="flex gap-2 text-sm">
                      <dt className="w-28 shrink-0 text-muted">Confidence</dt>
                      <dd>{finding.confidence}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
