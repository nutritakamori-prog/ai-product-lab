import { listProjects } from "@/services/projects";

export interface ProjectRef {
  id: string;
  name: string;
}

export type ProjectResolution =
  | { status: "RESOLVED"; project: ProjectRef }
  | { status: "AMBIGUOUS"; candidates: ProjectRef[] }
  | { status: "NOT_FOUND"; existing: ProjectRef[] };

// Generic words that would match almost any project name and tell the
// resolver nothing — excluded from the word-overlap check below so "meu
// sistema de agenda" matches on "agenda", never on "sistema" alone.
const STOPWORDS = new Set(["app", "web", "sistema", "projeto", "sistemas", "projetos", "meu", "minha", "nosso", "nossa", "the", "and"]);

function significantWords(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9áéíóúâêôãõç]+/i)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

/**
 * BLOCO 4 — resolves a natural reference ("o LAB", "meu sistema de agenda")
 * to a real Project row already in the database. Never guesses: tries an
 * exact/verbatim substring of a real project's name first; if that's
 * inconclusive, falls back to real-word overlap (a real, non-generic word
 * from the project's own name appearing in the message). Zero matches ->
 * NOT_FOUND (with the real list, so the Brain can offer it rather than
 * invent a project). More than one -> AMBIGUOUS, so the caller asks which
 * one instead of picking arbitrarily — the explicit rule from the brief
 * ("não adivinhar quando houver ambiguidade significativa").
 *
 * "o lab"/"a lab"/"lab" alone is special-cased to prefer a project whose own
 * name contains "lab" — the one standing self-evaluation case the domain
 * model already documents (evaluation-mission.ts: "the LAB evaluating its
 * own /projects page today"), not a general synonym table.
 */
export async function resolveProjectReference(text: string): Promise<ProjectResolution> {
  const projects = await listProjects();
  const refs: ProjectRef[] = projects.map((p) => ({ id: p.id, name: p.name }));
  if (refs.length === 0) return { status: "NOT_FOUND", existing: [] };

  const normalized = text.toLowerCase();

  const verbatim = refs.filter((p) => normalized.includes(p.name.toLowerCase()));
  if (verbatim.length === 1) return { status: "RESOLVED", project: verbatim[0] };
  if (verbatim.length > 1) return { status: "AMBIGUOUS", candidates: verbatim };

  const wordMatches = refs.filter((p) => {
    const words = significantWords(p.name);
    return words.length > 0 && words.some((word) => normalized.includes(word));
  });
  if (wordMatches.length === 1) return { status: "RESOLVED", project: wordMatches[0] };
  if (wordMatches.length > 1) return { status: "AMBIGUOUS", candidates: wordMatches };

  if (/\blab\b/.test(normalized)) {
    const labLike = refs.filter((p) => p.name.toLowerCase().includes("lab"));
    if (labLike.length === 1) return { status: "RESOLVED", project: labLike[0] };
    if (labLike.length > 1) return { status: "AMBIGUOUS", candidates: labLike };
  }

  return { status: "NOT_FOUND", existing: refs };
}
