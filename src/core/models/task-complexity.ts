import type { ModelTier } from "@/generated/prisma/client";

/**
 * Deterministic, LLM-free "task -> ModelTier" classification — no model
 * call is ever made to decide this. Reuses the existing ModelTier enum and
 * cost tiers exactly as they are (src/core/models/provider.ts's
 * MODEL_TIER_TO_ID already maps each of these three values to a concrete
 * model id); this module never introduces a tier of its own. Cheapest by
 * default: absent a clear signal in the task text, LOW_COST wins.
 */

const HIGH_REASONING_PATTERN =
  /\b(an[aá]lise profunda|investiga[cç][aã]o complexa|s[ií]ntese de m[uú]ltiplas evid[eê]ncias|sintetizar m[uú]ltiplas evid[eê]ncias|deep analysis|complex investigation|synthesi[sz]e multiple evidence)\b/i;

const MULTI_CRITERIA_PATTERN = /\b(m[uú]ltiplos crit[eé]rios|v[aá]rios crit[eé]rios|multiple criteria)\b/i;
// "comparação de evidências" is a phrase, but the trigger word alone
// (comparar/comparação/comparando/"compare") should count regardless of
// exact phrasing — as long as evidence is what's being compared.
const COMPARISON_WORD_PATTERN = /\bcompar\w*\b/i;
const EVIDENCE_WORD_PATTERN = /\bevid[eê]ncias?\b|\bevidence\b/i;

/**
 * Pure classification of the task text alone — no notion of an agent's own
 * configuration. Checked most-expensive-first, since a task can plausibly
 * match more than one pattern; falls back to LOW_COST for anything
 * ambiguous or unmatched (the "no clear reason for a pricier model" case).
 */
export function classifyTaskComplexity(task: string): ModelTier {
  if (HIGH_REASONING_PATTERN.test(task)) return "HIGH_REASONING";
  const comparesEvidence = COMPARISON_WORD_PATTERN.test(task) && EVIDENCE_WORD_PATTERN.test(task);
  if (MULTI_CRITERIA_PATTERN.test(task) || comparesEvidence) return "BALANCED";
  return "LOW_COST";
}

const TIER_RANK: Record<ModelTier, number> = { LOW_COST: 0, BALANCED: 1, HIGH_REASONING: 2 };

/**
 * Combines the task's own complexity signal with an agent's already-
 * configured tier: only ever escalates, never silently downgrades. When
 * the task gives no clear reason for a pricier model (classifyTaskComplexity
 * returns LOW_COST — the ambiguous/simple case), the agent simply keeps
 * using whatever tier it's already configured with — this is what lets
 * existing agent configuration/behavior stay compatible with this layer.
 */
export function selectModelTier(task: string, currentTier: ModelTier): ModelTier {
  const required = classifyTaskComplexity(task);
  return TIER_RANK[required] > TIER_RANK[currentTier] ? required : currentTier;
}
