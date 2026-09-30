"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import type { RunEvaluationMissionActionState } from "./actions";
import { submitEvaluationMission } from "./evaluation-mission-helpers";

const INITIAL_STATE: RunEvaluationMissionActionState = { missionRunId: null, error: null };

// The seven agents that actually exist today (see agents/index.ts) — never a
// new one invented here just to fill out the form. Order matches the
// Command Center's own team listing (src/app/product-intelligence/page.tsx).
const AVAILABLE_AGENTS = [
  { id: "new-user", label: "New User" },
  { id: "qa-agent", label: "QA" },
  { id: "ux-agent", label: "UX" },
  { id: "accessibility-agent", label: "Accessibility" },
  { id: "product-agent", label: "Product" },
  { id: "performance-agent", label: "Performance" },
  { id: "security-agent", label: "Security" },
];

/**
 * The Evaluation Mission form: a small config (Target URL, Objective, Task,
 * requestedAgents, Project) that starts a real, persisted
 * EvaluationMissionRun (see createAndRunMissionEvaluation) and navigates to
 * its own page (/test-lab/missions/[id]) once it exists — the one place a
 * Mission's result is ever shown, so it survives a refresh and can be
 * revisited. `error` here is only ever a form-input problem (missing
 * project, no agent selected, invalid Mission shape); a real execution
 * failure is recorded on the run itself instead of surfacing here.
 */
export function EvaluationMissionForm({ projects }: { projects: { id: string; name: string; createdAt: Date }[] }) {
  const [state, formAction, isPending] = useActionState(submitEvaluationMission, INITIAL_STATE);
  const router = useRouter();
  const agentsFieldsetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.missionRunId) router.push(`/test-lab/missions/${state.missionRunId}`);
  }, [state.missionRunId, router]);

  // Pure convenience: checks every existing checkbox in the group — never a
  // separate "select everyone" mechanism, and never a way to pick an agent
  // this form doesn't already offer above.
  function selectFullTeam() {
    const checkboxes = agentsFieldsetRef.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    checkboxes?.forEach((checkbox) => {
      checkbox.checked = true;
    });
  }

  return (
    <div className="rounded-lg border border-border p-5">
      <form action={formAction} className="flex flex-col gap-3">
        <div>
          <label htmlFor="mission-targetUrl" className="text-xs text-muted">
            Target URL
          </label>
          <input
            id="mission-targetUrl"
            name="targetUrl"
            type="text"
            required
            disabled={isPending}
            className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50"
            placeholder="https://exemplo.com"
          />
        </div>
        <div>
          <label htmlFor="mission-objective" className="text-xs text-muted">
            Objective
          </label>
          <input
            id="mission-objective"
            name="objective"
            type="text"
            required
            disabled={isPending}
            className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50"
            placeholder="Confirmar que o botão Continuar aparece após o login"
          />
        </div>
        <div>
          <label htmlFor="mission-task" className="text-xs text-muted">
            Task
          </label>
          <textarea
            id="mission-task"
            name="task"
            required
            rows={2}
            disabled={isPending}
            className="mt-1 w-full resize-none rounded-md border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50"
            placeholder="Abra o sistema, clique no botão Entrar e verifique se o botão Continuar aparece."
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">Agents solicitados</span>
            <button
              type="button"
              onClick={selectFullTeam}
              disabled={isPending}
              className="text-xs text-muted underline decoration-dotted hover:text-foreground disabled:opacity-50"
            >
              Equipe completa
            </button>
          </div>
          <div ref={agentsFieldsetRef} className="mt-1.5 flex flex-wrap gap-4">
            {AVAILABLE_AGENTS.map((agent) => (
              <label key={agent.id} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="requestedAgents" value={agent.id} disabled={isPending} />
                {agent.label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="mission-projectId" className="text-xs text-muted">
            Project
          </label>
          <select
            id="mission-projectId"
            name="projectId"
            required
            disabled={isPending || projects.length === 0}
            defaultValue=""
            className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50"
          >
            <option value="" disabled>
              {projects.length === 0 ? "No projects yet" : "Select a project"}
            </option>
            {/* createdAt appended so two projects that happen to share a name (nothing
                enforces uniqueness) can still be told apart here — see run-task-form.tsx's
                own Project select, which needed the exact same fix. */}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} — {project.createdAt.toLocaleString("en-US")}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={isPending || projects.length === 0} className="mt-1 w-full">
          {isPending || state.missionRunId ? "Executando avaliação…" : "Executar avaliação"}
        </Button>
      </form>

      {state.error ? <p className="mt-4 text-sm">{state.error}</p> : null}
    </div>
  );
}
