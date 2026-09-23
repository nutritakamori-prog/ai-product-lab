import type { AgentDefinition } from "@agents/system/agent-protocol";
import { EVIDENCE_FIRST_REMINDER } from "@agents/system/evidence-rules";
import { buildContextBlock } from "@/core/context/build-context";

export function buildSystemPrompt(agent: Pick<AgentDefinition, "systemPrompt">): string {
  return [agent.systemPrompt, "", EVIDENCE_FIRST_REMINDER].join("\n");
}

export function buildUserPrompt(task: string, context?: Record<string, unknown>): string {
  return [`Task: ${task}`, "", "Context:", buildContextBlock(context)].join("\n");
}
