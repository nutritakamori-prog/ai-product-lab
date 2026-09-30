"use client";

import { useActionState } from "react";
import { Button } from "@/components/button";
import { createProjectAction, type CreateProjectActionState } from "./actions";
import { PROJECT_MODES } from "@/domain/project";

const INITIAL_STATE: CreateProjectActionState = { createdName: null, error: null };

/**
 * Extracted from ProjectsPage into its own client component only because
 * useActionState (the same mechanism RunTaskForm/EvaluationMissionForm
 * already use) needs one — the form's own fields/layout are otherwise
 * unchanged. The one behavioral difference: a successful submission now
 * shows an explicit confirmation naming the created project, instead of
 * giving no feedback beyond the list itself changing.
 */
export function CreateProjectForm() {
  const [state, formAction, isPending] = useActionState(createProjectAction, INITIAL_STATE);

  return (
    <form action={formAction} className="h-fit rounded-lg border border-border p-5">
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
            disabled={isPending}
            className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50"
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
            disabled={isPending}
            className="mt-1 w-full resize-none rounded-md border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50"
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
            disabled={isPending}
            className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50"
          >
            {PROJECT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={isPending} className="mt-1 w-full">
          {isPending ? "Creating…" : "Create project"}
        </Button>
      </div>

      {state.error ? <p className="mt-3 text-sm">{state.error}</p> : null}
      {state.createdName ? <p className="mt-3 text-sm">Project &quot;{state.createdName}&quot; created successfully.</p> : null}
    </form>
  );
}
