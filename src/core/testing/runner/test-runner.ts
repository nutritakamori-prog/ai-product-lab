import { open, stat } from "node:fs/promises";
import path from "node:path";
import type { Project, Prisma, TestRunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import type { ResolvedAgent } from "@/core/agents/registry";
import { runAgent } from "@/core/runtime/run-agent";
import type { AgentOutput } from "@/domain/agent-output";
import type { TestScenario } from "../scenarios/test-protocol";
import { startAppServer } from "./app-server";
import { launchBrowserAdapter, type PlaywrightBrowserAdapter } from "./browser-adapter";

/**
 * One real, evidenced observation gathered while attempting a scenario step
 * — never a claim about something that wasn't actually done. See the
 * fundamental rule in src/core/testing/README.md.
 */
export interface Observation {
  action: string;
  expected: string;
  observed: string;
  evidence: string;
}

interface StepExecutionResult {
  observations: Observation[];
}

// Where a scenario run's Playwright trace .zip lands — a plain local folder,
// same idea as .next or coverage: an execution artifact, not something
// committed (see .gitignore). One file per TestRun, named by its own id, so
// no separate id/naming scheme is needed.
const TRACE_DIR = path.join(process.cwd(), "test-results", "traces");

// A ZIP's End Of Central Directory record: fixed 22-byte tail (no archive
// comment, which Playwright traces never set), signature 0x06054b50, total
// entry count at offset 10. Reading just this is enough to tell a real
// trace.stop() output from an empty/truncated one — not a full ZIP parser,
// and deliberately not one: this only needs to answer "is there at least
// one entry", not read the archive.
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_EOCD_SIZE = 22;
const ZIP_EOCD_SEARCH_WINDOW = 1024;

interface TraceUsability {
  usable: boolean;
  reason: string | null;
}

/**
 * Confirms a trace is actually usable, not just present: exists, non-empty,
 * and its ZIP end-of-central-directory record reports at least one entry.
 * Zero new dependencies — plain `fs` reads and a manual EOCD scan.
 */
async function checkTraceUsability(tracePath: string): Promise<TraceUsability> {
  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(tracePath);
  } catch {
    return { usable: false, reason: "trace file does not exist" };
  }
  if (stats.size === 0) {
    return { usable: false, reason: "trace file is empty (0 bytes)" };
  }
  if (stats.size < ZIP_EOCD_SIZE) {
    return { usable: false, reason: `trace file is too small to be a valid ZIP (${stats.size} bytes)` };
  }

  const handle = await open(tracePath, "r");
  try {
    const windowSize = Math.min(ZIP_EOCD_SEARCH_WINDOW, stats.size);
    const buffer = Buffer.alloc(windowSize);
    await handle.read(buffer, 0, windowSize, stats.size - windowSize);

    let eocdOffset = -1;
    for (let i = buffer.length - ZIP_EOCD_SIZE; i >= 0; i--) {
      if (buffer.readUInt32LE(i) === ZIP_EOCD_SIGNATURE) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) {
      return { usable: false, reason: "trace file has no valid ZIP end-of-central-directory record" };
    }

    const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
    if (totalEntries === 0) {
      return { usable: false, reason: "trace ZIP has a valid structure but contains zero entries" };
    }
    return { usable: true, reason: null };
  } finally {
    await handle.close();
  }
}

/**
 * Polls `read()` until its result satisfies `matches`, or gives up. Used
 * after a real browser interaction (a click/submit) to wait for the
 * resulting DOM state instead of trusting that the action itself
 * completing means the page already reflects it.
 */
export async function pollUntil(
  read: () => Promise<string>,
  matches: (text: string) => boolean,
  { attempts = 10, delayMs = 300 }: { attempts?: number; delayMs?: number } = {},
): Promise<{ found: boolean; lastText: string }> {
  let lastText = "";
  for (let i = 0; i < attempts; i++) {
    lastText = await read();
    if (matches(lastText)) return { found: true, lastText };
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return { found: false, lastText };
}

/** Best-effort test-data cleanup — never affects the run's own result. */
async function cleanupTestProject(name: string): Promise<void> {
  try {
    const organization = await getDefaultOrganization();
    const created = await db.project.findFirst({ where: { organizationId: organization.id, name } });
    if (created) await db.project.delete({ where: { id: created.id } });
  } catch {
    // best-effort
  }
}

/**
 * Scenario-specific step execution: a small, honest mapping from "what this
 * scenario's steps mean" to "what code actually runs to find out" — one
 * entry per scenario that can be exercised for real today. Deliberately not
 * a generic step-interpreter: with a single scenario, that would be solving
 * a problem we don't have yet. Add an entry here alongside each new
 * scenario file, not a framework ahead of need.
 */
const STEP_EXECUTORS: Record<string, (tracePath: string) => Promise<StepExecutionResult>> = {
  "new-user-creates-first-project": async (tracePath) => {
    const observations: Observation[] = [];
    const name = `Test scenario project ${Date.now()}`;
    let server: Awaited<ReturnType<typeof startAppServer>> | null = null;
    let adapter: PlaywrightBrowserAdapter | null = null;

    try {
      server = await startAppServer();
      adapter = await launchBrowserAdapter(server.baseUrl, tracePath);

      const home = await adapter.navigate("/");
      observations.push({
        action: "Open the AI Product Lab application in a real browser (Playwright + Chromium).",
        expected: "The application responds and renders a real page.",
        observed: `Loaded ${home.url} — page.content() returned ${home.html.length} bytes of real HTML.`,
        evidence: `page.goto("${home.url}") resolved without error.`,
      });

      await adapter.click('a[href="/projects"]');
      const nav = await pollUntil(() => adapter!.getText("body"), (text) => text.includes("New project"));
      observations.push({
        action: 'Click the "Projects" link in the app\'s real navigation.',
        expected: 'The Projects page loads and shows a "New project" form.',
        observed: nav.found
          ? 'The page now contains "New project" — the Projects page loaded.'
          : `After clicking, the page did not contain "New project" within the wait window (3s). Page text sample: "${nav.lastText.slice(0, 200)}"`,
        evidence: `getText("body") after the click ${nav.found ? "contains" : "does not contain"} "New project".`,
      });

      const formText = await adapter.getText("form");
      const formHasCreateAction = formText.includes("Create project");
      observations.push({
        action: "Read the create-project form actually rendered on the Projects page.",
        expected: 'A form with a "Create project" action is present.',
        observed: formHasCreateAction
          ? 'A form containing "Create project" was found in the DOM.'
          : `No "Create project" text found in the form. Form text: "${formText.slice(0, 200)}"`,
        evidence: `getText("form") = "${formText.slice(0, 200)}"`,
      });

      await adapter.fill("#name", name);
      const filledValue = await adapter.getText("#name");
      observations.push({
        action: `Fill the project name field with "${name}".`,
        expected: "The name field holds exactly the entered value.",
        observed:
          filledValue === name
            ? `The name field now reads "${filledValue}".`
            : `The name field reads "${filledValue}", not the entered value.`,
        evidence: `getText("#name") (the field's real inputValue) = "${filledValue}".`,
      });

      await adapter.click('button[type="submit"]');
      const submit = await pollUntil(() => adapter!.getText("body"), (text) => text.includes(name));
      observations.push({
        action: "Submit the form to create the project.",
        expected: "The new project subsequently appears in the project list.",
        observed: submit.found
          ? `The project name "${name}" is present on the page after submitting.`
          : `The project name "${name}" was NOT found on the page after submitting (waited ~3s). Page text sample: "${submit.lastText.slice(0, 300)}"`,
        evidence: `getText("body") after submit ${submit.found ? "contains" : "does not contain"} "${name}".`,
      });
    } catch (err) {
      observations.push({
        action: "Drive the real browser through the project-creation flow.",
        expected: "Every step above completes and produces real DOM evidence.",
        observed: `Browser automation failed before completing: ${err instanceof Error ? err.message : String(err)}`,
        evidence:
          "An exception was thrown by the browser/server automation itself — this is an infrastructure failure, not evidence about the application's own behavior.",
      });
    } finally {
      if (adapter) await adapter.close().catch(() => {});
      if (server) await server.close().catch(() => {});
      await cleanupTestProject(name);
    }

    return { observations };
  },

  "new-user-discovers-and-creates-first-project": async (tracePath) => {
    const observations: Observation[] = [];
    const name = `Test scenario project ${Date.now()}`;
    let server: Awaited<ReturnType<typeof startAppServer>> | null = null;
    let adapter: PlaywrightBrowserAdapter | null = null;

    try {
      server = await startAppServer();
      adapter = await launchBrowserAdapter(server.baseUrl, tracePath);

      const home = await adapter.navigate("/");
      const homeText = await adapter.getText("body");
      observations.push({
        action: "Open the application and read the initial screen, as a first-time user would see it.",
        expected: "The home screen renders and shows real content.",
        observed: `Loaded ${home.url}. Home screen text sample: "${homeText.slice(0, 200)}"`,
        evidence: `getText("body") on the home screen returned ${homeText.length} real characters.`,
      });

      // Discoverability check: a plain click on the "Projects" link (the
      // only route to it a new user could plausibly find, since nothing
      // else advertises it). Playwright only succeeds a click when the
      // element is actually visible, enabled, and stable — a successful
      // click IS real evidence it was discoverable, not just clickable in
      // principle. This is deliberately not a UI change to make discovery
      // "easier" — it's the same real nav link scenario 1 uses.
      let projectsLinkFound = true;
      let clickError: string | null = null;
      try {
        await adapter.click('a[href="/projects"]');
      } catch (err) {
        projectsLinkFound = false;
        clickError = err instanceof Error ? err.message : String(err);
      }
      observations.push({
        action: 'From the initial screen, attempt to discover and click a "Projects" link.',
        expected: "A visible, clickable link to Projects exists on the initial screen.",
        observed: projectsLinkFound
          ? "A link to /projects was visible and clickable from the initial screen."
          : `No clickable link to /projects could be found from the initial screen: ${clickError}`,
        evidence: projectsLinkFound
          ? 'click(\'a[href="/projects"]\') resolved without error (Playwright only succeeds this when the element is actually visible, enabled, and stable).'
          : `click('a[href="/projects"]') threw: ${clickError}`,
      });

      if (!projectsLinkFound) {
        observations.push({
          action: "Locate the create-project action, create the project, and confirm the result.",
          expected: "These steps follow after reaching the Projects page.",
          observed: "Not attempted — the Projects page was never reached.",
          evidence: "No further browser actions were taken after the failed discovery step.",
        });
        return { observations };
      }

      const nav = await pollUntil(() => adapter!.getText("body"), (text) => text.includes("New project"));
      observations.push({
        action: "Confirm the Projects page actually loaded after the click.",
        expected: 'The page shows a "New project" form.',
        observed: nav.found
          ? 'The page now contains "New project" — the Projects page loaded.'
          : `After clicking, the page did not contain "New project" within the wait window (3s). Page text sample: "${nav.lastText.slice(0, 200)}"`,
        evidence: `getText("body") after the click ${nav.found ? "contains" : "does not contain"} "New project".`,
      });

      const formText = await adapter.getText("form");
      const formHasCreateAction = formText.includes("Create project");
      observations.push({
        action: "Locate the create-project action on the Projects page.",
        expected: 'A form with a "Create project" action is visible, without further navigation.',
        observed: formHasCreateAction
          ? 'A form containing "Create project" was found in the DOM, on the same page reached from the initial screen.'
          : `No "Create project" text found in the form. Form text: "${formText.slice(0, 200)}"`,
        evidence: `getText("form") = "${formText.slice(0, 200)}"`,
      });

      if (!formHasCreateAction) {
        observations.push({
          action: "Create the project and confirm the result.",
          expected: "These steps follow after locating the create-project action.",
          observed: "Not attempted — the create-project action was never located.",
          evidence: "No further browser actions were taken after the failed discovery step.",
        });
        return { observations };
      }

      await adapter.fill("#name", name);
      await adapter.click('button[type="submit"]');
      const submit = await pollUntil(() => adapter!.getText("body"), (text) => text.includes(name));
      observations.push({
        action: "Create the project using only what was discovered on the page, then confirm the result.",
        expected: "The new project appears, confirming the unassisted flow succeeded.",
        observed: submit.found
          ? `The project name "${name}" is present on the page after submitting.`
          : `The project name "${name}" was NOT found on the page after submitting (waited ~3s). Page text sample: "${submit.lastText.slice(0, 300)}"`,
        evidence: `getText("body") after submit ${submit.found ? "contains" : "does not contain"} "${name}".`,
      });
    } catch (err) {
      observations.push({
        action: "Drive the real browser through the unassisted discovery-and-creation flow.",
        expected: "Every step above completes and produces real DOM evidence.",
        observed: `Browser automation failed before completing: ${err instanceof Error ? err.message : String(err)}`,
        evidence:
          "An exception was thrown by the browser/server automation itself — this is an infrastructure failure, not evidence about the application's own behavior.",
      });
    } finally {
      if (adapter) await adapter.close().catch(() => {});
      if (server) await server.close().catch(() => {});
      await cleanupTestProject(name);
    }

    return { observations };
  },

  "new-user-explores-agents-area": async (tracePath) => {
    const observations: Observation[] = [];
    let server: Awaited<ReturnType<typeof startAppServer>> | null = null;
    let adapter: PlaywrightBrowserAdapter | null = null;

    try {
      server = await startAppServer();
      adapter = await launchBrowserAdapter(server.baseUrl, tracePath);

      const home = await adapter.navigate("/");
      observations.push({
        action: "Open the AI Product Lab application in a real browser (Playwright + Chromium).",
        expected: "The application responds and renders a real page.",
        observed: `Loaded ${home.url} — page.content() returned ${home.html.length} bytes of real HTML.`,
        evidence: `page.goto("${home.url}") resolved without error.`,
      });

      await adapter.click('a[href="/agents"]');
      const nav = await pollUntil(() => adapter!.getText("body"), (text) => text.includes("agent library"));
      observations.push({
        action: 'Click the "Agents" link in the app\'s real navigation.',
        expected: "The Agents page loads and shows what this area offers.",
        observed: nav.found
          ? 'The page now contains "agent library" — the Agents page loaded.'
          : `After clicking, the page did not contain "agent library" within the wait window (3s). Page text sample: "${nav.lastText.slice(0, 200)}"`,
        evidence: `getText("body") after the click ${nav.found ? "contains" : "does not contain"} "agent library".`,
      });

      const mainText = await adapter.getText("main");
      observations.push({
        action: "Read the real content of the Agents page, as a new user trying to understand what this area offers would.",
        expected: "The page's real content gives some indication of what the Agents area is for.",
        observed: `Real page content: "${mainText.slice(0, 400)}"`,
        evidence: `getText("main") returned ${mainText.length} real characters.`,
      });
    } catch (err) {
      observations.push({
        action: "Drive the real browser to explore the Agents area.",
        expected: "Every step above completes and produces real DOM evidence.",
        observed: `Browser automation failed before completing: ${err instanceof Error ? err.message : String(err)}`,
        evidence:
          "An exception was thrown by the browser/server automation itself — this is an infrastructure failure, not evidence about the application's own behavior.",
      });
    } finally {
      if (adapter) await adapter.close().catch(() => {});
      if (server) await server.close().catch(() => {});
      // No test-data cleanup needed — this scenario is read-only, it never
      // creates or mutates anything.
    }

    return { observations };
  },

  "new-user-explores-settings": async (tracePath) => {
    const observations: Observation[] = [];
    let server: Awaited<ReturnType<typeof startAppServer>> | null = null;
    let adapter: PlaywrightBrowserAdapter | null = null;

    try {
      server = await startAppServer();
      adapter = await launchBrowserAdapter(server.baseUrl, tracePath);

      const home = await adapter.navigate("/");
      observations.push({
        action: "Open the AI Product Lab application in a real browser (Playwright + Chromium).",
        expected: "The application responds and renders a real page.",
        observed: `Loaded ${home.url} — page.content() returned ${home.html.length} bytes of real HTML.`,
        evidence: `page.goto("${home.url}") resolved without error.`,
      });

      await adapter.click('a[href="/settings"]');
      const nav = await pollUntil(() => adapter!.getText("body"), (text) => text.includes("Organization details"));
      observations.push({
        action: 'Click the "Settings" link in the app\'s real navigation.',
        expected: "The Settings page loads and shows what this area offers.",
        observed: nav.found
          ? 'The page now contains "Organization details" — the Settings page loaded.'
          : `After clicking, the page did not contain "Organization details" within the wait window (3s). Page text sample: "${nav.lastText.slice(0, 200)}"`,
        evidence: `getText("body") after the click ${nav.found ? "contains" : "does not contain"} "Organization details".`,
      });

      const mainText = await adapter.getText("main");
      observations.push({
        action: "Read the real content of the Settings page, as a new user trying to understand what this area offers would.",
        expected: "The page's real content gives some indication of what the Settings area is for.",
        observed: `Real page content: "${mainText.slice(0, 400)}"`,
        evidence: `getText("main") returned ${mainText.length} real characters.`,
      });
    } catch (err) {
      observations.push({
        action: "Drive the real browser to explore the Settings area.",
        expected: "Every step above completes and produces real DOM evidence.",
        observed: `Browser automation failed before completing: ${err instanceof Error ? err.message : String(err)}`,
        evidence:
          "An exception was thrown by the browser/server automation itself — this is an infrastructure failure, not evidence about the application's own behavior.",
      });
    } finally {
      if (adapter) await adapter.close().catch(() => {});
      if (server) await server.close().catch(() => {});
      // No test-data cleanup needed — this scenario is read-only, it never
      // creates or mutates anything.
    }

    return { observations };
  },

  "new-user-submits-empty-project-name": async (tracePath) => {
    const observations: Observation[] = [];
    let server: Awaited<ReturnType<typeof startAppServer>> | null = null;
    let adapter: PlaywrightBrowserAdapter | null = null;

    try {
      server = await startAppServer();
      adapter = await launchBrowserAdapter(server.baseUrl, tracePath);

      const home = await adapter.navigate("/");
      observations.push({
        action: "Open the AI Product Lab application in a real browser (Playwright + Chromium).",
        expected: "The application responds and renders a real page.",
        observed: `Loaded ${home.url} — page.content() returned ${home.html.length} bytes of real HTML.`,
        evidence: `page.goto("${home.url}") resolved without error.`,
      });

      await adapter.click('a[href="/projects"]');
      const nav = await pollUntil(() => adapter!.getText("body"), (text) => text.includes("New project"));
      observations.push({
        action: 'Click the "Projects" link in the app\'s real navigation.',
        expected: "The Projects page loads and shows the create-project form.",
        observed: nav.found
          ? 'The page now contains "New project" — the create-project form is present.'
          : `After clicking, the page did not contain "New project" within the wait window (3s). Page text sample: "${nav.lastText.slice(0, 200)}"`,
        evidence: `getText("body") after the click ${nav.found ? "contains" : "does not contain"} "New project".`,
      });

      const nameBefore = await adapter.getText("#name");
      observations.push({
        action: "Check the project name field before attempting to submit, without filling it in.",
        expected: "The name field is empty, since nothing has been typed into it.",
        observed: `The name field's real value is "${nameBefore}".`,
        evidence: `getText("#name") (the field's real inputValue) = "${nameBefore}".`,
      });

      await adapter.click('button[type="submit"]');
      const stillOnForm = await pollUntil(() => adapter!.getText("body"), (text) => text.includes("Create project"));
      observations.push({
        action: "Attempt to submit the create-project form with the required name field left empty.",
        expected: "The invalid submission is prevented and the user stays on the create-project form.",
        observed: stillOnForm.found
          ? 'After clicking submit with an empty name, the page still shows the "Create project" form — the submission did not go through.'
          : `After clicking submit with an empty name, the page no longer shows "Create project" within the wait window (3s). Page text sample: "${stillOnForm.lastText.slice(0, 300)}"`,
        evidence: `getText("body") after the submit attempt ${stillOnForm.found ? "still contains" : "no longer contains"} "Create project".`,
      });

      const nameAfter = await adapter.getText("#name");
      observations.push({
        action: "Check the project name field again after the blocked submission attempt.",
        expected: "The name field is still empty — no unexpected page reload should have changed form state.",
        observed: `The name field's real value is "${nameAfter}".`,
        evidence: `getText("#name") after the submit attempt = "${nameAfter}".`,
      });

      const bodyAfter = stillOnForm.lastText || (await adapter.getText("body"));
      const hasValidationWording = /required|must not be empty|please (fill|enter)|this field/i.test(bodyAfter);
      observations.push({
        action: "Look for any in-page (DOM) text explaining why the submission was blocked.",
        expected:
          "Either a visible in-app message explains the problem, or none exists — native browser validation (e.g. a tooltip) may still be the only feedback, and this adapter cannot inspect that.",
        observed: hasValidationWording
          ? "The page's real text contains wording that looks like a validation message."
          : "No validation-message-like wording was found in the page's real text. This does not rule out native browser validation (a tooltip), which is not inspectable through this adapter — that limit is explicit, not treated as proof of a missing message.",
        evidence: `getText("body") ${hasValidationWording ? "matched" : "did not match"} common validation-message wording (required/must/please fill/this field).`,
      });
    } catch (err) {
      observations.push({
        action: "Drive the real browser through the empty-name submission attempt.",
        expected: "Every step above completes and produces real DOM evidence.",
        observed: `Browser automation failed before completing: ${err instanceof Error ? err.message : String(err)}`,
        evidence:
          "An exception was thrown by the browser/server automation itself — this is an infrastructure failure, not evidence about the application's own behavior.",
      });
    } finally {
      if (adapter) await adapter.close().catch(() => {});
      if (server) await server.close().catch(() => {});
      // No cleanup attempted here on purpose: this scenario should never
      // create a project (name is required both client- and server-side).
      // If one somehow got created anyway, silently deleting it would
      // erase real evidence of a bug instead of surfacing it.
    }

    return { observations };
  },

  "new-user-creates-project-and-returns-to-list": async (tracePath) => {
    const observations: Observation[] = [];
    const name = `Test scenario project ${Date.now()}`;
    let server: Awaited<ReturnType<typeof startAppServer>> | null = null;
    let adapter: PlaywrightBrowserAdapter | null = null;

    try {
      server = await startAppServer();
      adapter = await launchBrowserAdapter(server.baseUrl, tracePath);

      const home = await adapter.navigate("/");
      observations.push({
        action: "Open the AI Product Lab application in a real browser (Playwright + Chromium).",
        expected: "The application responds and renders a real page.",
        observed: `Loaded ${home.url} — page.content() returned ${home.html.length} bytes of real HTML.`,
        evidence: `page.goto("${home.url}") resolved without error.`,
      });

      await adapter.click('a[href="/projects"]');
      const nav = await pollUntil(() => adapter!.getText("body"), (text) => text.includes("New project"));
      observations.push({
        action: 'Click the "Projects" link in the app\'s real navigation.',
        expected: "The Projects page loads and shows the create-project form.",
        observed: nav.found
          ? 'The page now contains "New project" — the Projects page loaded.'
          : `After clicking, the page did not contain "New project" within the wait window (3s). Page text sample: "${nav.lastText.slice(0, 200)}"`,
        evidence: `getText("body") after the click ${nav.found ? "contains" : "does not contain"} "New project".`,
      });

      await adapter.fill("#name", name);
      const filledValue = await adapter.getText("#name");
      observations.push({
        action: `Fill the project name field with a unique test name, "${name}".`,
        expected: "The name field holds exactly the entered value.",
        observed:
          filledValue === name
            ? `The name field now reads "${filledValue}".`
            : `The name field reads "${filledValue}", not the entered value.`,
        evidence: `getText("#name") (the field's real inputValue) = "${filledValue}".`,
      });

      await adapter.click('button[type="submit"]');
      const created = await pollUntil(() => adapter!.getText("body"), (text) => text.includes(name));
      observations.push({
        action: "Submit the form to create the project.",
        expected: "The new project is created and appears on the page.",
        observed: created.found
          ? `The project name "${name}" is present on the page immediately after submitting.`
          : `The project name "${name}" was NOT found on the page after submitting (waited ~3s). Page text sample: "${created.lastText.slice(0, 300)}"`,
        evidence: `getText("body") after submit ${created.found ? "contains" : "does not contain"} "${name}".`,
      });

      await adapter.click('a[href="/"]');
      const awayFromProjects = await pollUntil(
        () => adapter!.getText("body"),
        (text) => text.includes("AI Product Lab is in its foundation phase"),
      );
      observations.push({
        action: 'Navigate away, to Dashboard, using the app\'s real navigation — a real interaction, not a page reload of Projects itself.',
        expected: "The Dashboard page loads, confirming real navigation away from Projects happened.",
        observed: awayFromProjects.found
          ? "The page now shows the Dashboard's real content."
          : `After clicking, the page did not show the Dashboard's content within the wait window (3s). Page text sample: "${awayFromProjects.lastText.slice(0, 200)}"`,
        evidence: `getText("body") after the click ${awayFromProjects.found ? "contains" : "does not contain"} "AI Product Lab is in its foundation phase".`,
      });

      await adapter.click('a[href="/projects"]');
      const backOnProjects = await pollUntil(() => adapter!.getText("body"), (text) => text.includes("New project"));
      observations.push({
        action: 'Return to Projects using the app\'s real navigation.',
        expected: "The Projects page loads again, on a fresh page load (not just the post-submit render).",
        observed: backOnProjects.found
          ? 'The page now contains "New project" — the Projects page loaded again.'
          : `After clicking, the page did not contain "New project" within the wait window (3s). Page text sample: "${backOnProjects.lastText.slice(0, 200)}"`,
        evidence: `getText("body") after returning ${backOnProjects.found ? "contains" : "does not contain"} "New project".`,
      });

      const persisted = await pollUntil(() => adapter!.getText("body"), (text) => text.includes(name));
      observations.push({
        action: "Confirm the created project is still visible after navigating away and back.",
        expected: "The project created earlier is still present in the list on this fresh page load.",
        observed: persisted.found
          ? `The project name "${name}" is present on the Projects page after returning to it.`
          : `The project name "${name}" was NOT found on the Projects page after returning to it (waited ~3s). Page text sample: "${persisted.lastText.slice(0, 300)}"`,
        evidence: `getText("body") after returning to Projects ${persisted.found ? "contains" : "does not contain"} "${name}".`,
      });
    } catch (err) {
      observations.push({
        action: "Drive the real browser through creating a project and returning to the list.",
        expected: "Every step above completes and produces real DOM evidence.",
        observed: `Browser automation failed before completing: ${err instanceof Error ? err.message : String(err)}`,
        evidence:
          "An exception was thrown by the browser/server automation itself — this is an infrastructure failure, not evidence about the application's own behavior.",
      });
    } finally {
      if (adapter) await adapter.close().catch(() => {});
      if (server) await server.close().catch(() => {});
      await cleanupTestProject(name);
    }

    return { observations };
  },

  "qa-agent-validates-empty-project-name-submission": async (tracePath) => {
    const observations: Observation[] = [];
    let server: Awaited<ReturnType<typeof startAppServer>> | null = null;
    let adapter: PlaywrightBrowserAdapter | null = null;

    try {
      server = await startAppServer();
      adapter = await launchBrowserAdapter(server.baseUrl, tracePath);

      const home = await adapter.navigate("/");
      observations.push({
        action: "Open the AI Product Lab application in a real browser (Playwright + Chromium).",
        expected: "The application responds and renders a real page.",
        observed: `Loaded ${home.url} — page.content() returned ${home.html.length} bytes of real HTML.`,
        evidence: `page.goto("${home.url}") resolved without error.`,
      });

      await adapter.click('a[href="/projects"]');
      const nav = await pollUntil(() => adapter!.getText("body"), (text) => text.includes("New project"));
      observations.push({
        action: 'Click the "Projects" link in the app\'s real navigation.',
        expected: "The Projects page loads and shows the create-project form.",
        observed: nav.found
          ? 'The page now contains "New project" — the create-project form is present.'
          : `After clicking, the page did not contain "New project" within the wait window (3s). Page text sample: "${nav.lastText.slice(0, 200)}"`,
        evidence: `getText("body") after the click ${nav.found ? "contains" : "does not contain"} "New project".`,
      });

      const nameBefore = await adapter.getText("#name");
      observations.push({
        action: "Confirm the project name field is actually empty before attempting submission.",
        expected: "The name field's real value is empty.",
        observed: `The name field's real value is "${nameBefore}".`,
        evidence: `getText("#name") (the field's real inputValue) = "${nameBefore}".`,
      });

      // A real database check, not just a UI-text check — this is what this
      // scenario adds on top of new-user-submits-empty-project-name.ts: does
      // an invalid (empty-name) project actually land in the database.
      const organization = await getDefaultOrganization();
      const countBefore = await db.project.count({ where: { organizationId: organization.id, name: "" } });

      await adapter.click('button[type="submit"]');
      const stillOnForm = await pollUntil(() => adapter!.getText("body"), (text) => text.includes("Create project"));
      observations.push({
        action: "Submit the create-project form with the required name field left empty.",
        expected: "The submission is blocked and the user remains on the create-project form.",
        observed: stillOnForm.found
          ? 'After clicking submit with an empty name, the page still shows the "Create project" form — the submission did not go through.'
          : `After clicking submit with an empty name, the page no longer shows "Create project" within the wait window (3s). Page text sample: "${stillOnForm.lastText.slice(0, 300)}"`,
        evidence: `getText("body") after the submit attempt ${stillOnForm.found ? "still contains" : "no longer contains"} "Create project".`,
      });

      const countAfter = await db.project.count({ where: { organizationId: organization.id, name: "" } });
      observations.push({
        action: "Query the database directly to check whether a project with an empty name was created by this submission attempt.",
        expected: "No project with an empty name exists after the attempt — the count is unchanged.",
        observed:
          countAfter === countBefore
            ? `No empty-name project was created — the count stayed at ${countAfter}.`
            : `An empty-name project WAS created — the count went from ${countBefore} to ${countAfter}.`,
        evidence: `db.project.count({ organizationId, name: "" }) before = ${countBefore}, after = ${countAfter}.`,
      });

      const nameAfter = await adapter.getText("#name");
      observations.push({
        action: "Check the project name field again after the blocked submission attempt.",
        expected: "The field's real state after the attempt is observed, whatever it is.",
        observed: `The name field's real value is "${nameAfter}".`,
        evidence: `getText("#name") after the submit attempt = "${nameAfter}".`,
      });
    } catch (err) {
      observations.push({
        action: "Drive the real browser through the QA verification of the empty-name submission.",
        expected: "Every step above completes and produces real DOM/database evidence.",
        observed: `Browser automation failed before completing: ${err instanceof Error ? err.message : String(err)}`,
        evidence:
          "An exception was thrown by the browser/server automation itself — this is an infrastructure failure, not evidence about the application's own behavior.",
      });
    } finally {
      if (adapter) await adapter.close().catch(() => {});
      if (server) await server.close().catch(() => {});
      // No cleanup attempted here on purpose, same reasoning as
      // new-user-submits-empty-project-name.ts: this scenario should never
      // create a project. If one somehow got created anyway, silently
      // deleting it would erase real evidence of a bug instead of surfacing it.
    }

    return { observations };
  },

  "qa-agent-verifies-project-persistence-after-creation": async (tracePath) => {
    const observations: Observation[] = [];
    const name = `QA persistence test ${Date.now()}`;
    let server: Awaited<ReturnType<typeof startAppServer>> | null = null;
    let adapter: PlaywrightBrowserAdapter | null = null;

    try {
      server = await startAppServer();
      adapter = await launchBrowserAdapter(server.baseUrl, tracePath);

      const home = await adapter.navigate("/");
      observations.push({
        action: "Open the AI Product Lab application in a real browser (Playwright + Chromium).",
        expected: "The application responds and renders a real page.",
        observed: `Loaded ${home.url} — page.content() returned ${home.html.length} bytes of real HTML.`,
        evidence: `page.goto("${home.url}") resolved without error.`,
      });

      await adapter.click('a[href="/projects"]');
      const nav = await pollUntil(() => adapter!.getText("body"), (text) => text.includes("New project"));
      observations.push({
        action: 'Click the "Projects" link in the app\'s real navigation.',
        expected: "The Projects page loads and shows the create-project form.",
        observed: nav.found
          ? 'The page now contains "New project" — the Projects page loaded.'
          : `After clicking, the page did not contain "New project" within the wait window (3s). Page text sample: "${nav.lastText.slice(0, 200)}"`,
        evidence: `getText("body") after the click ${nav.found ? "contains" : "does not contain"} "New project".`,
      });

      await adapter.fill("#name", name);
      const filledValue = await adapter.getText("#name");
      observations.push({
        action: `Fill the project name field with a unique test name, "${name}".`,
        expected: "The name field holds exactly the entered value.",
        observed:
          filledValue === name
            ? `The name field now reads "${filledValue}".`
            : `The name field reads "${filledValue}", not the entered value.`,
        evidence: `getText("#name") (the field's real inputValue) = "${filledValue}".`,
      });

      await adapter.click('button[type="submit"]');
      const created = await pollUntil(() => adapter!.getText("body"), (text) => text.includes(name));
      observations.push({
        action: "Submit the form to create the project and confirm the creation happened.",
        expected: "The new project is created and appears on the page.",
        observed: created.found
          ? `The project name "${name}" is present on the page immediately after submitting.`
          : `The project name "${name}" was NOT found on the page after submitting (waited ~3s). Page text sample: "${created.lastText.slice(0, 300)}"`,
        evidence: `getText("body") after submit ${created.found ? "contains" : "does not contain"} "${name}".`,
      });

      await adapter.click('a[href="/"]');
      const awayFromProjects = await pollUntil(
        () => adapter!.getText("body"),
        (text) => text.includes("AI Product Lab is in its foundation phase"),
      );
      observations.push({
        action: "Navigate away from Projects using the app's real navigation.",
        expected: "The Dashboard page loads, confirming real navigation away from Projects happened.",
        observed: awayFromProjects.found
          ? "The page now shows the Dashboard's real content."
          : `After clicking, the page did not show the Dashboard's content within the wait window (3s). Page text sample: "${awayFromProjects.lastText.slice(0, 200)}"`,
        evidence: `getText("body") after the click ${awayFromProjects.found ? "contains" : "does not contain"} "AI Product Lab is in its foundation phase".`,
      });

      await adapter.click('a[href="/projects"]');
      const backOnProjects = await pollUntil(() => adapter!.getText("body"), (text) => text.includes("New project"));
      observations.push({
        action: "Return to Projects using the app's real navigation.",
        expected: "The Projects page loads again, on a fresh page load (not just the post-submit render).",
        observed: backOnProjects.found
          ? 'The page now contains "New project" — the Projects page loaded again.'
          : `After clicking, the page did not contain "New project" within the wait window (3s). Page text sample: "${backOnProjects.lastText.slice(0, 200)}"`,
        evidence: `getText("body") after returning ${backOnProjects.found ? "contains" : "does not contain"} "New project".`,
      });

      const persisted = await pollUntil(() => adapter!.getText("body"), (text) => text.includes(name));
      observations.push({
        action: "Confirm the created project is still visible in the interface after navigating away and back.",
        expected: "The project created earlier is still present in the list on this fresh page load.",
        observed: persisted.found
          ? `The project name "${name}" is present on the Projects page after returning to it.`
          : `The project name "${name}" was NOT found on the Projects page after returning to it (waited ~3s). Page text sample: "${persisted.lastText.slice(0, 300)}"`,
        evidence: `getText("body") after returning to Projects ${persisted.found ? "contains" : "does not contain"} "${name}".`,
      });

      // The functional check this scenario adds on top of the new-user
      // version: confirm persistence directly at the data level, not just
      // by what the page renders.
      const organization = await getDefaultOrganization();
      const persistedRow = await db.project.findFirst({ where: { organizationId: organization.id, name } });
      observations.push({
        action: "Query the database directly to confirm the project genuinely persisted, independent of what the page renders.",
        expected: "A project row with this exact name exists in the database.",
        observed: persistedRow
          ? `A real database row exists for project "${name}" (id: ${persistedRow.id}).`
          : `No database row was found for project "${name}" — the interface may be showing something that isn't actually persisted.`,
        evidence: `db.project.findFirst({ organizationId, name: "${name}" }) ${persistedRow ? "found a row" : "found nothing"}.`,
      });
    } catch (err) {
      observations.push({
        action: "Drive the real browser through the QA verification of project persistence.",
        expected: "Every step above completes and produces real DOM/database evidence.",
        observed: `Browser automation failed before completing: ${err instanceof Error ? err.message : String(err)}`,
        evidence:
          "An exception was thrown by the browser/server automation itself — this is an infrastructure failure, not evidence about the application's own behavior.",
      });
    } finally {
      if (adapter) await adapter.close().catch(() => {});
      if (server) await server.close().catch(() => {});
      await cleanupTestProject(name);
    }

    return { observations };
  },
};

function buildScenarioTask(scenario: TestScenario, observations: Observation[]): string {
  const observationsText = observations
    .map(
      (o, i) =>
        `${i + 1}. ACTION: ${o.action}\n   EXPECTED: ${o.expected}\n   OBSERVED: ${o.observed}\n   EVIDENCE: ${o.evidence}`,
    )
    .join("\n\n");

  return [
    `You are analyzing a test run of the scenario "${scenario.name}".`,
    `Objective: ${scenario.objective}`,
    `Preconditions: ${scenario.preconditions.join("; ")}`,
    `Scenario steps: ${scenario.steps.join(" -> ")}`,
    `Expected outcome: ${scenario.expectedOutcome}`,
    "",
    "The following observations were actually gathered while attempting this scenario. Some steps could not be automated yet and are explicitly marked as such — treat those as having no evidence at all, not as a sign of a problem, and never claim to have observed something beyond what is listed here.",
    "",
    observationsText,
    "",
    'Based ONLY on the observations above, report status "FINDING" if there is a real, evidenced problem, "NO_FINDING" if everything that was actually checked worked as expected, or "UNCONFIRMED" if there is a suspicion you cannot back with evidence (for example because a step was not automated).',
  ].join("\n");
}

export interface RunTestScenarioInput {
  scenario: TestScenario;
  agent: ResolvedAgent;
  project: Pick<Project, "id">;
}

export interface RunTestScenarioResult {
  testRunId: string;
  status: TestRunStatus;
  findings: AgentOutput[];
  /**
   * Set when this run didn't complete because something in the execution
   * path itself threw (e.g. no ANTHROPIC_API_KEY, a network error) — never
   * because of anything the scenario observed about the app. Null in every
   * other case. See the try/catch below: this is what keeps such a failure
   * from being silently reinterpreted as a product finding.
   */
  infrastructureError: string | null;
}

/**
 * Orchestrates one attempt at a scenario: open a TestRun, run the
 * scenario's step executor to gather real observations, hand those to the
 * agent (via the existing Runtime — never reimplemented here) for analysis,
 * and close the TestRun with the resulting status/findings.
 */
export async function runTestScenario(input: RunTestScenarioInput): Promise<RunTestScenarioResult> {
  const { scenario, agent, project } = input;
  const startedAt = new Date();

  const testRun = await db.testRun.create({
    data: {
      scenarioId: scenario.id,
      agentId: agent.dbId,
      projectId: project.id,
      status: "RUNNING",
      startedAt,
    },
  });

  const executor = STEP_EXECUTORS[scenario.id];
  if (!executor) {
    await db.testRun.update({
      where: { id: testRun.id },
      data: {
        status: "BLOCKED",
        observedOutcome: `No step executor is registered for scenario "${scenario.id}" — nothing was actually run.`,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
      },
    });
    return { testRunId: testRun.id, status: "BLOCKED", findings: [], infrastructureError: null };
  }

  // One trace per TestRun, named by its own id — computed up front so both
  // the success and failure paths below can look for it under the same
  // name, regardless of how far the executor got.
  const tracePath = path.join(TRACE_DIR, `${testRun.id}.zip`);

  // Everything from here on can fail for reasons that have nothing to do
  // with the app being tested (a missing API key, a dropped connection,
  // ...). Once the TestRun row exists, this run must always close it —
  // never leave it stuck at RUNNING, and never let an infrastructure
  // failure surface as if the agent had judged the app itself.
  try {
    const { observations } = await executor(tracePath);
    const task = buildScenarioTask(scenario, observations);
    const runResult = await runAgent({ agent, project, task });

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    let status: TestRunStatus;
    let findings: AgentOutput[] = [];

    if (runResult.status === "FAILED" || !runResult.output) {
      // The agent execution itself failed (model/validation error) — this is
      // not a verdict on the scenario, it needs a human to look.
      status = "NEEDS_REVIEW";
    } else if (runResult.output.status === "FINDING") {
      status = "FAILED";
      findings = [runResult.output];
    } else if (runResult.output.status === "UNCONFIRMED") {
      status = "NEEDS_REVIEW";
      findings = [runResult.output];
    } else {
      status = "PASSED";
    }

    const traceUsability = await checkTraceUsability(tracePath);
    if (!traceUsability.usable) {
      console.warn(
        `[test-runner] Not persisting tracePath for TestRun ${testRun.id} (scenario "${scenario.id}"): ${traceUsability.reason}. This never affects the scenario's own PASSED/FAILED/NEEDS_REVIEW result — the trace is complementary evidence only.`,
      );
    }

    await db.testRun.update({
      where: { id: testRun.id },
      data: {
        status,
        executionId: runResult.executionId,
        observations: observations as unknown as Prisma.InputJsonValue,
        observedOutcome: observations[observations.length - 1]?.observed ?? null,
        findings: findings as unknown as Prisma.InputJsonValue,
        tracePath: traceUsability.usable ? tracePath : null,
        finishedAt,
        durationMs,
      },
    });

    return { testRunId: testRun.id, status, findings, infrastructureError: null };
  } catch (err) {
    const finishedAt = new Date();
    const message = err instanceof Error ? err.message : String(err);

    const traceUsability = await checkTraceUsability(tracePath);
    if (!traceUsability.usable) {
      console.warn(
        `[test-runner] Not persisting tracePath for TestRun ${testRun.id} (scenario "${scenario.id}"): ${traceUsability.reason}. This never affects the scenario's own status.`,
      );
    }

    await db.testRun.update({
      where: { id: testRun.id },
      data: {
        status: "NEEDS_REVIEW",
        observedOutcome: `Infrastructure error — this run did not complete and produced no evidence about the app: ${message}`,
        tracePath: traceUsability.usable ? tracePath : null,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      },
    });

    return { testRunId: testRun.id, status: "NEEDS_REVIEW", findings: [], infrastructureError: message };
  }
}
