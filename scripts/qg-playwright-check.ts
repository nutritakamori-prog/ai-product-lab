/**
 * A real, repeatable browser flow through the LAB QG — the one Playwright
 * check Fase 9 asks for. Uses the `playwright` package already a
 * devDependency (the same one src/core/testing/runner/browser-adapter.ts
 * uses for real Evaluation Missions) directly, rather than adding
 * `@playwright/test` plus its own config/runner just for a single flow.
 *
 * Requires the dev server running at http://localhost:3000 first
 * (GEMINI_API_KEY="" npm run dev, to avoid real model calls) and at least
 * one Agent seeded (any real Evaluation Mission run already seeds all
 * seven — see AgentRegistry.getBySlug).
 *
 * Run with: npx tsx scripts/qg-playwright-check.ts
 */
import { chromium } from "playwright";

const BASE_URL = process.env.QG_CHECK_BASE_URL ?? "http://localhost:3000";

async function main() {
  const browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined,
  );
  const page = await browser.newPage();
  let failures = 0;

  function check(label: string, condition: boolean) {
    console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
    if (!condition) failures += 1;
  }

  // 1. Open /qg and see the office.
  await page.goto(`${BASE_URL}/qg`, { waitUntil: "networkidle" });
  const initialBody = await page.textContent("body");
  check("abrir /qg mostra o título LAB QG", Boolean(initialBody?.includes("LAB QG")));
  check("o escritório mostra as 7 estações de agente", ["New User", "QA Agent", "UX Agent", "Accessibility Agent", "Product Agent", "Performance Agent", "Security Agent"].every((name) => initialBody?.includes(name)));

  // 2. Click an agent and see real data.
  await page.click("button[aria-label^='New User']");
  await page.waitForSelector("[role='dialog']");
  const agentPanelBody = await page.textContent("[role='dialog']");
  check("clicar em um agente abre um painel com o objetivo real do agente", Boolean(agentPanelBody?.includes("first-time user")));
  await page.keyboard.press("Escape");
  await page.waitForSelector("[role='dialog']", { state: "detached" });

  // 3. Click Product Intelligence and confirm real navigation (no duplicate flow).
  // A plain click + waitForLoadState("networkidle") is unreliable here: this
  // is a client-side <Link> transition, which can leave the network already
  // idle before the URL/DOM actually update — the same SPA-transition race
  // documented elsewhere in this codebase. waitForURL is the robust way to
  // wait for a client-side route change to actually land.
  await page.click("a:has-text('Product Intelligence')");
  await page.waitForURL("**/product-intelligence");
  check("clicar em Product Intelligence navega para a página real existente", page.url().endsWith("/product-intelligence"));

  // 4. Return to the QG.
  await page.goto(`${BASE_URL}/qg`, { waitUntil: "networkidle" });
  check("voltar para /qg funciona", page.url().endsWith("/qg"));

  await browser.close();

  console.log(`\n${failures === 0 ? "TODOS OS PASSOS PASSARAM" : `${failures} PASSO(S) FALHARAM`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
