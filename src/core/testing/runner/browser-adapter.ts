import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

/**
 * The seam test-runner.ts depends on instead of talking to Playwright
 * directly. `PlaywrightBrowserAdapter` below is the real implementation;
 * keeping this interface small and generic (navigate/click/fill/getText)
 * means a step executor never needs to know it's Playwright specifically.
 */
export interface BrowserAdapter {
  navigate(path: string): Promise<{ url: string; html: string }>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  getText(selector: string): Promise<string>;
  /**
   * Unlike click/fill/getText — which wait out Playwright's normal
   * actionability timeout and throw if the element never appears —
   * `exists` answers the yes/no question itself: `true` if the element
   * attaches to the DOM within a short wait, `false` if it doesn't. A
   * timeout here means "not found", not an infrastructure error, so it's
   * caught internally and turned into `false` rather than propagated.
   */
  exists(selector: string): Promise<boolean>;
}

// Pre-installed in this environment (see docs/DECISIONS.md) — passed
// explicitly so Playwright never tries to download a browser matching its
// own npm package's pinned revision, which isn't necessarily what's here.
const CHROMIUM_EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "/opt/pw-browsers/chromium";

// Short and deliberate: exists() is asked precisely when the caller doesn't
// know whether the element is there, so a "not found" answer should come
// back quickly rather than waiting out click/fill's much longer default
// actionability timeout.
const EXISTS_TIMEOUT_MS = 3_000;

/**
 * Real UI automation against a real running instance of the app (see
 * app-server.ts). Every method does exactly what it says and nothing more:
 * `click`/`fill` perform a real, actionability-checked Playwright
 * interaction (it throws if the element isn't actually there and
 * clickable/fillable — never a silent no-op); `getText` reads the live DOM
 * afterward, which is what test-runner.ts uses as EVIDENCE — a
 * click/fill call not throwing is never treated as evidence on its own.
 */
export class PlaywrightBrowserAdapter implements BrowserAdapter {
  private tracingStarted = false;

  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly baseUrl: string,
    private readonly tracePath: string | null,
  ) {}

  /**
   * `tracePath`, when given, is where a Playwright trace (screenshots, DOM
   * snapshots, actions, network) for this scenario's whole run gets written
   * on `close()` — complementary structural evidence alongside the textual
   * OBSERVED/EVIDENCE a step executor gathers itself; it never replaces it,
   * and nothing in this adapter treats the trace file's existence as proof
   * of anything about the app. Tracing is started once per adapter (one
   * BrowserContext, covering the whole scenario), never per action.
   */
  static async launch(baseUrl: string, tracePath?: string): Promise<PlaywrightBrowserAdapter> {
    const browser = await chromium.launch({
      executablePath: CHROMIUM_EXECUTABLE_PATH,
      headless: true,
      args: ["--no-sandbox"], // required to launch Chromium as root in this environment
    });
    const page = await browser.newPage();
    const context = page.context();

    const adapter = new PlaywrightBrowserAdapter(browser, context, page, baseUrl, tracePath ?? null);
    if (tracePath) {
      try {
        await mkdir(path.dirname(tracePath), { recursive: true });
        await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
        adapter.tracingStarted = true;
      } catch {
        // Best-effort — a trace is complementary evidence, never a
        // precondition for running the scenario itself.
      }
    }
    return adapter;
  }

  async navigate(path: string): Promise<{ url: string; html: string }> {
    const target = new URL(path, this.baseUrl).toString();
    await this.page.goto(target, { waitUntil: "networkidle" });
    return { url: this.page.url(), html: await this.page.content() };
  }

  async click(selector: string): Promise<void> {
    await this.page.locator(selector).first().click();
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.page.locator(selector).first().fill(value);
  }

  /**
   * Returns what's actually visible/set at `selector` — `innerText` for
   * ordinary elements, `inputValue` for form fields (which have no text
   * children to read), so this stays one generic method instead of the
   * interface needing a second, field-specific getter.
   */
  async getText(selector: string): Promise<string> {
    const locator = this.page.locator(selector).first();
    const tagName = await locator.evaluate((el) => el.tagName.toLowerCase());
    if (tagName === "input" || tagName === "textarea" || tagName === "select") {
      return locator.inputValue();
    }
    return locator.innerText();
  }

  /**
   * A real, actionability-independent presence check: waits briefly for the
   * element to attach to the DOM (it doesn't need to be visible/clickable —
   * unlike click/fill, this never interacts with it) and reports what
   * actually happened, never invents a result either way.
   */
  async exists(selector: string): Promise<boolean> {
    try {
      await this.page.locator(selector).first().waitFor({ state: "attached", timeout: EXISTS_TIMEOUT_MS });
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    try {
      if (this.tracingStarted && this.tracePath) {
        await this.context.tracing.stop({ path: this.tracePath });
      }
    } catch {
      // Best-effort, same reasoning as tracing.start above — never let a
      // trace-writing failure prevent the browser from actually closing.
    } finally {
      await this.browser.close();
    }
  }
}

export async function launchBrowserAdapter(baseUrl: string, tracePath?: string): Promise<PlaywrightBrowserAdapter> {
  return PlaywrightBrowserAdapter.launch(baseUrl, tracePath);
}
