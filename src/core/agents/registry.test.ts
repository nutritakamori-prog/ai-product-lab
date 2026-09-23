import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AgentRegistry } from "./registry";

// Real integration test against local Postgres and the real agent library
// (only "new-user" exists in it right now). The Agent row this creates for
// "new-user" is NOT cleaned up afterward — a library agent's operational row
// is meant to persist, exactly like it would in real use; getBySlug/list are
// find-or-create and idempotent, so re-running these tests is safe.
describe("AgentRegistry (integration)", () => {
  describe("discovery", () => {
    it("lists every agent id known to the library", () => {
      expect(AgentRegistry.discoverSlugs()).toContain("new-user");
    });
  });

  describe("loadDefinition", () => {
    it("loads and validates the new-user definition from its file", () => {
      const definition = AgentRegistry.loadDefinition("new-user");
      expect(definition).not.toBeNull();
      expect(definition?.id).toBe("new-user");
      expect(definition?.category).toBe("EXPERIENCE");
      expect(definition?.systemPrompt.length).toBeGreaterThan(0);
      // whenNotToCall is required, not decorative — confirm it's really there.
      expect(definition?.whenNotToCall.length).toBeGreaterThan(0);
    });

    it("returns null for an id that doesn't exist in the library", () => {
      expect(AgentRegistry.loadDefinition("does-not-exist")).toBeNull();
    });
  });

  describe("getBySlug", () => {
    it("resolves new-user with its operational state merged in", async () => {
      const agent = await AgentRegistry.getBySlug("new-user");
      expect(agent).not.toBeNull();
      expect(agent?.id).toBe("new-user");
      expect(agent?.dbId).toBeTruthy();
      expect(agent?.tokenBudget).toBeGreaterThan(0);
      expect(typeof agent?.enabled).toBe("boolean");
    });

    it("returns null for an unknown slug without touching the database", async () => {
      const before = await db.agent.count();
      const agent = await AgentRegistry.getBySlug("does-not-exist");
      const after = await db.agent.count();
      expect(agent).toBeNull();
      expect(after).toBe(before);
    });

    it("is idempotent — calling it twice doesn't create a second row", async () => {
      await AgentRegistry.getBySlug("new-user");
      const countAfterFirst = await db.agent.count({ where: { slug: "new-user" } });
      await AgentRegistry.getBySlug("new-user");
      const countAfterSecond = await db.agent.count({ where: { slug: "new-user" } });
      expect(countAfterFirst).toBe(1);
      expect(countAfterSecond).toBe(1);
    });

    it("never overwrites an operator's change to enabled once the row exists", async () => {
      await AgentRegistry.getBySlug("new-user"); // ensure the row exists
      await db.agent.update({ where: { slug: "new-user" }, data: { enabled: false } });

      const agent = await AgentRegistry.getBySlug("new-user");
      expect(agent?.enabled).toBe(false); // DB wins, not the file's `enabled: true`

      // restore, so other tests/manual runs see the library's intended default
      await db.agent.update({ where: { slug: "new-user" }, data: { enabled: true } });
    });
  });

  describe("list / listEnabled", () => {
    it("list includes new-user", async () => {
      const all = await AgentRegistry.list();
      expect(all.map((a) => a.id)).toContain("new-user");
    });

    it("listEnabled only includes agents whose resolved state is enabled", async () => {
      await db.agent.update({ where: { slug: "new-user" }, data: { enabled: true } });
      const enabled = await AgentRegistry.listEnabled();
      expect(enabled.map((a) => a.id)).toContain("new-user");

      await db.agent.update({ where: { slug: "new-user" }, data: { enabled: false } });
      const disabled = await AgentRegistry.listEnabled();
      expect(disabled.map((a) => a.id)).not.toContain("new-user");

      await db.agent.update({ where: { slug: "new-user" }, data: { enabled: true } }); // restore
    });
  });
});
