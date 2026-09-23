import type { Agent } from "@/generated/prisma/client";
import { buildContextBlock } from "@/core/context/build-context";

const EVIDENCE_FIRST_REMINDER =
  'Only report what you can back with concrete evidence (ACTION/EXPECTED/OBSERVED). If you have nothing concrete to report, respond with status "NO_FINDING" instead of inventing one. Never state something as fact without evidence.';

export function buildSystemPrompt(agent: Agent): string {
  return [agent.systemPrompt, "", EVIDENCE_FIRST_REMINDER].join("\n");
}

export function buildUserPrompt(task: string, context?: Record<string, unknown>): string {
  return [`Task: ${task}`, "", "Context:", buildContextBlock(context)].join("\n");
}
