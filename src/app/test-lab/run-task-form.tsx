"use client";

import { useActionState } from "react";
import { Button } from "@/components/button";
import { runLabTaskAction, type RunLabTaskActionState } from "./actions";

const INITIAL_STATE: RunLabTaskActionState = { result: null, error: null };

/**
 * The minimal manual entry point into the LAB: pick a project, describe
 * what to test, run it through the existing runLabTask() -> Smart Router
 * pipeline, and show the result inline. useActionState (React 19/Next.js
 * App Router's own mechanism) gives the pending state and the returned
 * result for free — no API route, no client-side fetch, no extra state
 * management, and the disabled button while `isPending` is what prevents a
 * duplicate submission.
 */
export function RunTaskForm({ projects }: { projects: { id: string; name: string; createdAt: Date }[] }) {
  const [state, formAction, isPending] = useActionState(runLabTaskAction, INITIAL_STATE);

  return (
    <div className="rounded-lg border border-border p-5">
      <form action={formAction} className="flex flex-col gap-3">
        <div>
          <label htmlFor="task" className="text-xs text-muted">
            O que você quer que o LAB teste?
          </label>
          <textarea
            id="task"
            name="task"
            required
            rows={3}
            disabled={isPending}
            className="mt-1 w-full resize-none rounded-md border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50"
            placeholder="e.g. Avalie a clareza do fluxo de criação de projeto"
          />
        </div>
        <div>
          <label htmlFor="projectId" className="text-xs text-muted">
            Project
          </label>
          <select
            id="projectId"
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
                enforces uniqueness) can still be told apart here — the name alone
                previously left no way to know which one a given option actually was. */}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} — {project.createdAt.toLocaleString("en-US")}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={isPending || projects.length === 0} className="mt-1 w-full">
          {isPending ? "Executando…" : "Executar teste"}
        </Button>
      </form>

      {state.error ? <p className="mt-4 text-sm">{state.error}</p> : null}

      {state.result ? (
        <div className="mt-4 rounded-md border border-border p-4">
          <div className="flex items-center justify-between">
            <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted">
              {state.result.status}
            </span>
            <span className="text-xs text-muted">
              {state.result.agentsCalled.length} chamada{state.result.agentsCalled.length === 1 ? "" : "s"}
            </span>
          </div>

          <p className="mt-3 text-sm font-medium">
            {state.result.agentsCalled.length > 0 ? state.result.agentsCalled.join(" → ") : "Nenhum agente executado"}
          </p>

          {state.result.collaborated ? (
            <p className="mt-1 text-xs text-accent">Houve colaboração entre agentes.</p>
          ) : null}
          {state.result.browserExecuted ? (
            <p className="mt-1 text-xs text-muted">Executado de verdade no navegador.</p>
          ) : null}

          <p className="mt-3 text-sm">{state.result.summary}</p>

          {state.result.finding ? (
            <p className="mt-2 text-sm">
              <span className="text-xs text-muted">Finding: </span>
              {state.result.finding}
            </p>
          ) : null}
          {state.result.evidence ? (
            <p className="mt-2 text-sm">
              <span className="text-xs text-muted">Evidence: </span>
              {state.result.evidence}
            </p>
          ) : null}
          {state.result.recommendation ? (
            <p className="mt-2 text-sm">
              <span className="text-xs text-muted">Recommendation: </span>
              {state.result.recommendation}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
