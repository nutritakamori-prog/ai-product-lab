import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { startAppServer, type AppServerHandle } from "./app-server";
import { launchBrowserAdapter, type PlaywrightBrowserAdapter } from "./browser-adapter";
import { pollUntil } from "./test-runner";

/**
 * Focused on the adapter's own mechanics against the real Projects page —
 * not a broad end-to-end suite of the whole app. Requires a production
 * build to already exist ("npm run build"); see app-server.ts.
 */
describe("PlaywrightBrowserAdapter", () => {
  let server: AppServerHandle;
  let adapter: PlaywrightBrowserAdapter;

  beforeAll(async () => {
    server = await startAppServer();
    adapter = await launchBrowserAdapter(server.baseUrl);
  }, 30_000);

  afterAll(async () => {
    await adapter?.close();
    await server?.close();
    await db.$disconnect();
  });

  it("navigates to a real page and returns its real URL and HTML", async () => {
    const result = await adapter.navigate("/");
    expect(result.url).toBe(`${server.baseUrl}/`);
    expect(result.html.length).toBeGreaterThan(0);
    expect(result.html).toContain("<html");
  });

  it("reads real text out of the rendered Projects form", async () => {
    await adapter.navigate("/projects");
    const formText = await adapter.getText("form");
    expect(formText).toContain("New project");
    expect(formText).toContain("Create project");
  });

  it("fills a real input and reads its value back via inputValue, not textContent", async () => {
    await adapter.navigate("/projects");
    const value = `adapter-test-${Date.now()}`;
    await adapter.fill("#name", value);
    expect(await adapter.getText("#name")).toBe(value);
  });

  it(
    "throws instead of silently succeeding when a selector doesn't exist",
    async () => {
      await adapter.navigate("/projects");
      // Playwright's own actionability timeout (default 30s) is what
      // actually fires here — waited out deliberately rather than shortened,
      // since a shorter internal timeout isn't exposed by the BrowserAdapter
      // interface and adding one would be exactly the kind of interface
      // change this step was told not to make.
      await expect(adapter.click("#this-selector-does-not-exist")).rejects.toThrow();
    },
    35_000,
  );

  it("creates a project through the real UI and observes it appear via the DOM", async () => {
    const name = `Adapter e2e test ${Date.now()}`;

    await adapter.navigate("/projects");
    await adapter.fill("#name", name);
    await adapter.click('button[type="submit"]');

    const result = await pollUntil(() => adapter.getText("body"), (text) => text.includes(name));
    expect(result.found).toBe(true);

    // Confirm the same thing a real user would see on a fresh load, not
    // just the post-submit render.
    await adapter.navigate("/projects");
    const afterReload = await adapter.getText("body");
    expect(afterReload).toContain(name);

    // Test-data hygiene, same reasoning as test-runner.ts's own cleanup.
    const organization = await getDefaultOrganization();
    const created = await db.project.findFirst({ where: { organizationId: organization.id, name } });
    expect(created).not.toBeNull();
    if (created) await db.project.delete({ where: { id: created.id } });
  }, 20_000);
});
