"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { rerunMissionAction } from "@/app/test-lab/actions";
import { canRerunMissionRun } from "@/app/test-lab/evaluation-mission-helpers";
import type { ModelProviderKind } from "@/generated/prisma/client";

/**
 * "Executar novamente" — but only when this Run's own persisted `provider`
 * is a real, known, non-CLAUDE_CODE kind (canRerunMissionRun). The guard is
 * re-checked server-side too (rerunMissionAction), so this component's job
 * is purely presentational: show the reproducible button when it's true,
 * or a short, non-technical explanation when it's not — never a button that
 * silently reruns with a different executor than the one the user believes
 * they're reproducing (Claude Code, or an unknown/legacy Run).
 */
export function RerunMissionButton({ missionRunId, provider }: { missionRunId: string; provider: ModelProviderKind | null }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (!canRerunMissionRun(provider)) {
    return (
      <p className="text-sm text-muted">
        {provider === "CLAUDE_CODE"
          ? "Este Run foi executado via Claude Code e não pode ser repetido pela UI. Reexecução via Claude Code."
          : "Este Run foi executado externamente e não pode ser repetido pela UI."}
      </p>
    );
  }

  function handleClick() {
    startTransition(async () => {
      const state = await rerunMissionAction(missionRunId);
      if (state.missionRunId) {
        router.push(`/test-lab/missions/${state.missionRunId}`);
      } else {
        setError(state.error);
      }
    });
  }

  return (
    <div>
      <Button type="button" variant="secondary" onClick={handleClick} disabled={isPending}>
        {isPending ? "Executando…" : "Executar novamente"}
      </Button>
      {error ? <p className="mt-2 text-sm">{error}</p> : null}
    </div>
  );
}
