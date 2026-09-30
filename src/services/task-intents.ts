import { startAppServer } from "@/core/testing/runner/app-server";
import { launchBrowserAdapter, type BrowserAdapter } from "@/core/testing/runner/browser-adapter";
import { fillAndSubmitCreateProjectForm, type Observation } from "@/core/testing/runner/test-runner";

/**
 * Deterministic recognition of a small, fixed set of known task intents —
 * never an LLM call to decide this. Not a general "natural language to
 * browser actions" planner: an unrecognized task simply produces no
 * intent, and the caller (src/services/lab-task.ts) falls back to its
 * existing behavior (no browser evidence, agent may report UNCONFIRMED) —
 * exactly as it already does today. Extending this to more intents later
 * means adding another pattern here, one at a time, same spirit as
 * src/core/orchestrator/smart-router.ts's own rule list.
 */

export interface CreateProjectIntent {
  intent: "create-project";
  projectName: string;
}

export interface VerifyProjectExistsIntent {
  intent: "verify-project-exists";
  projectName: string;
}

export interface CheckElementExistsIntent {
  intent: "check-element-exists";
  url: string;
  elementDescription: string;
}

export type RecognizedIntent = CreateProjectIntent | VerifyProjectExistsIntent | CheckElementExistsIntent;

// Matches e.g. "Crie um projeto novo chamado Teste LAB", "Criar um novo
// projeto com o nome Teste LAB", "Crie projeto nomeado Teste LAB" — the verb
// "criar/crie", the word "projeto", then one of the naming connectors,
// capturing everything after it as the name.
const CREATE_PROJECT_PATTERN =
  /cri(?:ar|e)\s+(?:um\s+)?(?:novo\s+)?projeto\s+(?:novo\s+)?(?:chamado|com\s+o\s+nome(?:\s+de)?|nomeado)\s+(.+)$/i;

// Matches e.g. "Verifique se o projeto Teste LAB existe", "Verificar se o
// projeto Teste LAB existe", "Confira se o projeto Teste LAB existe" — a
// verify/confirm verb, "se o projeto", the name, then "existe".
const VERIFY_PROJECT_PATTERN = /(?:verificar|verifique|confira|confirmar|confirme)\s+se\s+o\s+projeto\s+(.+?)\s+existe\b/i;

// Matches e.g. "Abra https://exemplo.com e verifique se existe um botão de
// cadastro." — the first, narrow, deterministic pattern for the LAB's own
// "URL + free-form check" flow, distinct from the two project-management
// intents above. Anchored to the whole task (^...$, only an optional
// trailing "."/"!") so it never fires on a mere fragment of a longer,
// unrelated sentence. The URL is captured as a single non-whitespace token
// and handed to BrowserAdapter.navigate() as-is — an invalid one fails
// there (a real navigation error), not here (recognition never validates
// URL syntax itself; see checkElementExists below).
const CHECK_ELEMENT_EXISTS_PATTERN = /^abra\s+(\S+)\s+e\s+verifique\s+se\s+existe\s+(.+?)[.!]?$/i;

function cleanExtractedName(raw: string): string {
  return raw
    .trim()
    .replace(/^["'“]+/, "")
    .replace(/["'”.,!]+$/, "")
    .trim();
}

export function recognizeIntent(task: string): RecognizedIntent | null {
  const trimmed = task.trim();

  const verifyMatch = trimmed.match(VERIFY_PROJECT_PATTERN);
  if (verifyMatch) {
    const projectName = cleanExtractedName(verifyMatch[1]);
    if (projectName) return { intent: "verify-project-exists", projectName };
  }

  const createMatch = trimmed.match(CREATE_PROJECT_PATTERN);
  if (createMatch) {
    const projectName = cleanExtractedName(createMatch[1]);
    if (projectName) return { intent: "create-project", projectName };
  }

  const checkElementMatch = trimmed.match(CHECK_ELEMENT_EXISTS_PATTERN);
  if (checkElementMatch) {
    const url = checkElementMatch[1].trim();
    const elementDescription = checkElementMatch[2].trim();
    if (url && elementDescription) return { intent: "check-element-exists", url, elementDescription };
  }

  return null;
}

// A "referencing" verification clause — e.g. "verifique se ele apareceu" —
// that names no project because it refers back to the one just created
// earlier in the same task. Only ever consulted as the second half of an
// already-split composed task (see analyzeComposition below), never as a
// standalone whole-task match, so it can never invent a project name on its
// own — it only ever reuses a name a real recognized intent already produced.
// Anchored to the WHOLE clause (^...$, with only an optional trailing "."
// or "!") — not a bare .test() search — so a clause like "Nutri e verifique
// se ele apareceu" (leftover text in front of the real reference phrase)
// correctly fails instead of matching on the substring at the end.
const VERIFY_REFERENCE_PATTERN = /^(?:verificar|verifique|confira|confirmar|confirme|veja)\s+se\s+(?:ele|ela|isso)?\s*apareceu[.!]?$/i;

function recognizeReferenceVerify(
  clause: string,
  precedingIntent: CreateProjectIntent | VerifyProjectExistsIntent,
): VerifyProjectExistsIntent | null {
  if (!VERIFY_REFERENCE_PATTERN.test(clause.trim())) return null;
  return { intent: "verify-project-exists", projectName: precedingIntent.projectName };
}

// Checked in priority order — the more explicit a connector, the earlier it
// is tried, so a plain "e" (the weakest, most ambiguous signal — it could
// just as easily be part of a project name like "Sal e Pimenta") is only
// ever used to split a task when a stronger connector isn't present.
const SEQUENCE_CONNECTORS: RegExp[] = [/\be\s+depois\b/i, /\bdepois\b/i, /\bent[aã]o\b/i, /\be\b/i];

// A hint that a clause was meant as its own action (even if it doesn't
// resolve into a real intent) rather than being inert text that happens to
// sit after a connector — e.g. "abra o projeto para verificar a tela" isn't
// a recognized intent, but it clearly reads as an attempted action, unlike
// "Pimenta" in "Crie um projeto chamado Sal e Pimenta".
const ACTION_VERB_HINT = /\b(?:cri(?:ar|e)|verificar|verifique|confira|confirmar|confirme|veja|abrir|abra)\b/i;

function splitOnConnector(text: string, connector: RegExp): { left: string; right: string } | null {
  const match = connector.exec(text);
  if (!match) return null;
  const left = text.slice(0, match.index).trim();
  const right = text.slice(match.index + match[0].length).trim();
  if (!left || !right) return null;
  return { left, right };
}

interface CompositionAnalysis {
  intents: RecognizedIntent[];
  /**
   * True when the task contains a composition connector, its left-hand
   * clause is a real recognized intent, and the right-hand clause reads
   * like an attempted second action (see ACTION_VERB_HINT) that doesn't
   * resolve into a real intent — e.g. "Crie um projeto chamado Gamma e
   * depois abra o projeto para verificar a tela." In this case the task
   * must never fall back to CREATE_PROJECT_PATTERN's own greedy capture
   * swallowing the whole sentence into one intent's name, and must never be
   * treated as an ordinary non-project task either — it's a genuinely
   * unsupported composed task, and the caller (src/services/lab-task.ts)
   * needs to know that even though `intents` alone comes back empty just
   * like any other unrecognized task.
   */
  hasUnsupportedComposition: boolean;
}

function analyzeComposition(task: string): CompositionAnalysis {
  const trimmed = task.trim();
  let hasUnsupportedComposition = false;

  for (const connector of SEQUENCE_CONNECTORS) {
    const split = splitOnConnector(trimmed, connector);
    if (!split) continue;

    const leftIntent = recognizeIntent(split.left);
    if (!leftIntent) continue;

    const rightIntent =
      recognizeIntent(split.right) ??
      (leftIntent.intent === "check-element-exists" ? null : recognizeReferenceVerify(split.right, leftIntent));
    if (rightIntent) {
      return { intents: [leftIntent, rightIntent], hasUnsupportedComposition: false };
    }

    if (ACTION_VERB_HINT.test(split.right)) {
      hasUnsupportedComposition = true;
    }
  }

  if (hasUnsupportedComposition) {
    return { intents: [], hasUnsupportedComposition: true };
  }

  const single = recognizeIntent(trimmed);
  return { intents: single ? [single] : [], hasUnsupportedComposition: false };
}

/**
 * The composed version of recognizeIntent — still 100% deterministic, still
 * only the same two known intents, but able to represent a short sequence
 * of them for a task like "Crie um projeto chamado Taka e verifique se ele
 * apareceu." A split is only ever accepted when BOTH resulting halves
 * independently recognize as a real intent (the second half may also match
 * via recognizeReferenceVerify, reusing the first half's name) — a single
 * unrecognized half never turns into a silent partial sequence. When no
 * connector produces a fully valid split — and the failed split(s) gave no
 * sign of an attempted second action (see hasUnsupportedComposition below)
 * — this falls back to exactly today's single-intent behavior (recognizeIntent
 * on the whole task), so simple tasks — including ones whose real name
 * happens to contain "e", "depois" or "então" — are completely unaffected.
 */
export function recognizeIntents(task: string): RecognizedIntent[] {
  return analyzeComposition(task).intents;
}

/**
 * True when recognizeIntents(task) came back empty specifically because a
 * composed task's second action wasn't supported — not because the task
 * simply has nothing to do with create-project/verify-project-exists at
 * all. src/services/lab-task.ts uses this to make sure such a task is
 * treated as not executed rather than silently falling back to a single
 * garbled intent or being handed to an agent with no real evidence.
 */
export function hasUnsupportedComposition(task: string): boolean {
  return analyzeComposition(task).hasUnsupportedComposition;
}

// Only the element types this first flow actually needs to recognize —
// deliberately not a generic noun→role mapper. "botão"/"button" maps to the
// ARIA "button" role, which covers both real <button> elements and anything
// else exposing that role (e.g. a styled <a> or <div role="button">) —
// exactly the semantic check requested, rather than a brittle tag-only match.
const ELEMENT_ROLE_HINTS: { pattern: RegExp; role: string }[] = [
  { pattern: /\bbot(?:[aã]o|ão)\b/i, role: "button" },
  { pattern: /\blink\b/i, role: "link" },
];

const ELEMENT_DESCRIPTION_FILLER_WORDS = new Set(["um", "uma", "o", "a", "os", "as", "de", "do", "da", "dos", "das"]);

function escapeRegExpLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * Turns a free-form element description into a deterministic Playwright
 * selector — no heuristic beyond "does it name a known element type, and
 * what's left over after removing that word and filler words". Returns
 * null when the description doesn't name a known type (e.g. "algo estranho
 * na tela"), so the caller can report that honestly instead of guessing a
 * selector that isn't backed by anything.
 */
export function buildElementSelector(description: string): string | null {
  const hint = ELEMENT_ROLE_HINTS.find((h) => h.pattern.test(description));
  if (!hint) return null;

  const nameWords = description
    .split(/\s+/)
    .filter((word) => word && !ELEMENT_DESCRIPTION_FILLER_WORDS.has(word.toLowerCase()) && !hint.pattern.test(word));

  if (nameWords.length === 0) return `role=${hint.role}`;

  const nameHint = escapeRegExpLiteral(nameWords.join(" "));
  return `role=${hint.role}[name=/${nameHint}/i]`;
}

/**
 * Opens `url` directly (never via startAppServer — this is the one intent
 * that targets an arbitrary external page, not the LAB's own app) and
 * checks for an element matching `elementDescription`. Every Observation
 * reflects only what was actually observed: a real navigation, then either
 * a real exists() result or an honest "no reliable selector" — never a
 * guessed selector's result presented as if it were reliable. A real
 * navigation failure (bad URL, unreachable host) is left to propagate as an
 * exception rather than being caught and turned into an Observation — an
 * infrastructure failure is not evidence of anything about the page.
 */
async function checkElementExists(intent: CheckElementExistsIntent): Promise<Observation[]> {
  const adapter = await launchBrowserAdapter(intent.url);

  try {
    const page = await adapter.navigate(intent.url);
    const observations: Observation[] = [
      {
        action: `Open ${intent.url} in a real browser (Playwright + Chromium).`,
        expected: "The page responds and renders real content.",
        observed: `Loaded ${page.url} — page.content() returned ${page.html.length} bytes of real HTML.`,
        evidence: `page.goto("${page.url}") resolved without error.`,
      },
    ];

    const selector = buildElementSelector(intent.elementDescription);
    if (!selector) {
      observations.push({
        action: `Determine a reliable selector for "${intent.elementDescription}".`,
        expected: `A deterministic selector could be built for "${intent.elementDescription}".`,
        observed: `No deterministic selector could be built for "${intent.elementDescription}".`,
        evidence: `"${intent.elementDescription}" did not match any known, deterministically mappable element type.`,
      });
      return observations;
    }

    const found = await adapter.exists(selector);
    observations.push({
      action: `Check whether an element matching "${intent.elementDescription}" (selector: ${selector}) exists on the page.`,
      expected: `An element matching "${intent.elementDescription}" is present.`,
      observed: found
        ? `An element matching "${intent.elementDescription}" was found on the page.`
        : `No element matching "${intent.elementDescription}" was found on the page.`,
      evidence: `exists("${selector}") on ${page.url} -> ${found}.`,
    });
    return observations;
  } finally {
    await adapter.close().catch(() => {});
  }
}

/**
 * Checks whether a project named `name` really appears on the (already
 * loaded) Projects page — a single real read, never a fabricated result.
 * The page is server-rendered with `dynamic = "force-dynamic"`
 * (src/app/projects/page.tsx), so the real navigate() already waited for a
 * fresh render; no polling is needed the way the create flow needs it to
 * wait for a client-side update.
 */
export async function verifyProjectExists(adapter: BrowserAdapter, name: string): Promise<Observation[]> {
  const bodyText = await adapter.getText("body");
  const found = bodyText.includes(name);

  return [
    {
      action: `Check whether a project named "${name}" appears on the Projects page.`,
      expected: `A project named "${name}" is present in the list.`,
      observed: found
        ? `The project name "${name}" is present on the page.`
        : `The project name "${name}" was NOT found on the page.`,
      evidence: `getText("body") ${found ? "contains" : "does not contain"} "${name}".`,
    },
  ];
}

/**
 * Executes a recognized intent for real via the existing BrowserAdapter
 * infrastructure — never invented evidence. Both intents share the same
 * real "open the Projects page" first step; each then reuses its own
 * dedicated, already-existing real interaction — fillAndSubmitCreateProjectForm
 * for creation (same code as the "new-user-creates-first-project" scenario's
 * step executor), verifyProjectExists for a read-only check. Unlike a Test
 * Lab scenario's throwaway project, a project created this way is a real
 * user-requested action, so it's left in place — never cleaned up.
 */
export async function executeIntent(intent: RecognizedIntent): Promise<Observation[]> {
  // The only intent that targets an arbitrary external page rather than the
  // LAB's own app — it never needs (and must not use) startAppServer.
  if (intent.intent === "check-element-exists") {
    return checkElementExists(intent);
  }

  const server = await startAppServer();
  const adapter = await launchBrowserAdapter(server.baseUrl);

  try {
    const home = await adapter.navigate("/projects");
    const observations: Observation[] = [
      {
        action: "Open the Projects page in a real browser (Playwright + Chromium).",
        expected: "The application responds and renders a real page.",
        observed: `Loaded ${home.url} — page.content() returned ${home.html.length} bytes of real HTML.`,
        evidence: `page.goto("${home.url}") resolved without error.`,
      },
    ];

    if (intent.intent === "create-project") {
      observations.push(...(await fillAndSubmitCreateProjectForm(adapter, intent.projectName)));
    } else {
      observations.push(...(await verifyProjectExists(adapter, intent.projectName)));
    }

    return observations;
  } finally {
    await adapter.close().catch(() => {});
    await server.close().catch(() => {});
  }
}
