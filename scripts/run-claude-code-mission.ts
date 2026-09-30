import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { evaluationMissionSchema } from "@/domain/evaluation-mission";
import { runMissionEvaluation, createAndRunMissionEvaluation } from "@/services/evaluation-orchestrator";
import { setModelProviderForTesting } from "@/core/models/provider";
import { createClaudeCodeScriptedProvider } from "@/core/models/claude-code-scripted-provider";
import { getDefaultOrganization } from "@/services/organizations";
import { db } from "@/lib/db";

/**
 * The CLI entry point for "run a real EvaluationMission with Claude Code as
 * the reasoning executor" — see createClaudeCodeScriptedProvider's own doc
 * comment for why this is deliberately not a real provider/API. This file
 * is pure glue: it never needs editing between missions — only the JSON
 * artifacts in scripts/claude-code-mission/ do. PASS=evaluate goes through
 * createAndRunMissionEvaluation() — the exact same persistence path a live
 * /test-lab submission uses — so the mission it runs shows up as a real,
 * revisitable EvaluationMissionRun at /test-lab/missions/[id], not just in
 * this script's own console output.
 *
 * Two passes, run as two separate invocations, because a human reasoning as
 * the agent needs to see the real Observations before producing a genuine,
 * evidence-bound AgentOutput — there is no way around that:
 *
 *   1. Write scripts/claude-code-mission/mission.json (copy
 *      mission.example.json as a starting point): target, objective, task,
 *      requestedAgents, and a deterministic Plan (there is no real Task
 *      Planner in this mode — the Plan is authored the same way an
 *      AgentOutput is, by reasoning about the task).
 *
 *   2. PASS=observe npx tsx scripts/run-claude-code-mission.ts
 *      Runs the Plan against a real Browser (requestedAgents forced to []
 *      regardless of mission.json), unpersisted — this pass is pure
 *      reconnaissance — and writes scripts/claude-code-mission/context.json:
 *      the mission's own target/objective/task plus the real Observations.
 *      Nothing is invented here — this is the LAB's own real evidence.
 *
 *   3. Read context.json. For each entry in mission.json's requestedAgents,
 *      read that agent's real systemPrompt (agents/experience/new-user.ts,
 *      agents/qa/qa-agent.ts, agents/ux/ux-agent.ts — never copied into a
 *      second file) and reason genuinely from context.json's real
 *      Observations + objective + task. Write the resulting AgentOutput
 *      objects, in the same order as requestedAgents, to
 *      scripts/claude-code-mission/responses.json.
 *
 *   4. npx tsx scripts/run-claude-code-mission.ts   (PASS=evaluate, default)
 *      Re-runs the same Plan for real (a fresh Browser execution — Browser
 *      evidence is never replayed from context.json, matching
 *      runMissionEvaluation()'s own contract of gathering it once per real
 *      call) with responses.json's AgentOutputs scripted in, persisted via
 *      createAndRunMissionEvaluation(). Prints the outcome and writes it to
 *      scripts/claude-code-mission/report.json.
 */

const WORKSPACE_DIR = path.join(import.meta.dirname, "claude-code-mission");
const MISSION_PATH = path.join(WORKSPACE_DIR, "mission.json");
const CONTEXT_PATH = path.join(WORKSPACE_DIR, "context.json");
const RESPONSES_PATH = path.join(WORKSPACE_DIR, "responses.json");
const REPORT_PATH = path.join(WORKSPACE_DIR, "report.json");

const PASS = process.env.PASS === "observe" ? "observe" : "evaluate";

interface MissionFile {
  target: { url: string; name?: string };
  objective: string;
  task: string;
  requestedAgents: string[];
  plan: { actions: unknown[] };
}

function readJson<T>(filePath: string, hint: string): T {
  if (!existsSync(filePath)) {
    throw new Error(`${hint} not found at ${filePath}. See scripts/claude-code-mission/mission.example.json.`);
  }
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

async function main() {
  const missionFile = readJson<MissionFile>(MISSION_PATH, "Mission definition (mission.json)");

  const organization = await getDefaultOrganization();
  const project =
    (await db.project.findFirst({ where: { name: "AI Product Lab (claude-code-mission)" } })) ??
    (await db.project.create({ data: { organizationId: organization.id, name: "AI Product Lab (claude-code-mission)" } }));

  if (PASS === "observe") {
    const mission = evaluationMissionSchema.parse({
      id: `claude-code-mission-observe-${Date.now()}`,
      target: missionFile.target,
      objective: missionFile.objective,
      task: missionFile.task,
      requestedAgents: [],
    });

    setModelProviderForTesting(createClaudeCodeScriptedProvider([missionFile.plan]));
    const result = await runMissionEvaluation(mission, project);

    console.log("=== PASS: observe ===");
    console.log("missionId:", result.missionId);

    const context = {
      missionId: result.missionId,
      mission: { target: mission.target, objective: mission.objective, task: mission.task },
      requestedAgents: missionFile.requestedAgents,
      observations: result.observations,
    };
    writeFileSync(CONTEXT_PATH, JSON.stringify(context, null, 2));
    console.log(`\nWrote real Observations to ${CONTEXT_PATH}.`);
    console.log(
      "Read it, reason as each of mission.json's requestedAgents (their real systemPrompt is in agents/*.ts), then write responses.json.",
    );
  } else {
    const agentResponses = readJson<unknown[]>(RESPONSES_PATH, "Agent responses (responses.json)");
    if (agentResponses.length !== missionFile.requestedAgents.length) {
      throw new Error(
        `PASS=evaluate needs exactly ${missionFile.requestedAgents.length} entries in responses.json (one per mission.json's requestedAgents, same order), got ${agentResponses.length}. Run PASS=observe first, read context.json, then write responses.json.`,
      );
    }

    setModelProviderForTesting(createClaudeCodeScriptedProvider([missionFile.plan, ...agentResponses]));

    const record = await createAndRunMissionEvaluation(
      {
        target: missionFile.target,
        objective: missionFile.objective,
        task: missionFile.task,
        requestedAgents: missionFile.requestedAgents,
      },
      project,
    );

    console.log("=== PASS: evaluate ===");
    console.log("missionRunId:", record.id, "status:", record.status);
    if (record.error) console.log("error:", record.error);
    console.log("\n--- REPORT ---");
    console.log(JSON.stringify(record.report, null, 2));

    writeFileSync(REPORT_PATH, JSON.stringify(record, null, 2));
    console.log(`\nWrote the full result to ${REPORT_PATH}.`);
    console.log(`View it in the product at /test-lab/missions/${record.id}`);
  }

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("ERROR:", err instanceof Error ? err.message : String(err));
  await db.$disconnect();
  process.exit(1);
});
