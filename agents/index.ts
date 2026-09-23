import newUser from "./experience/new-user";
import type { AgentDefinition } from "./system/agent-protocol";

/**
 * The library's table of contents. Adding a new agent means: create the
 * definition file in the right category folder, then add one import + one
 * array entry here. The Registry (src/core/agents/registry.ts) reads only
 * this list — it never scans the filesystem at runtime.
 *
 * Why a static list instead of scanning /agents at runtime: this project
 * is a bundled Next.js app — a dynamic `import()` over a path computed at
 * runtime is not reliably included in a production build by the bundler.
 * A plain static import is the safe, standard way to do a plugin-style
 * registry in a bundled app, at the cost of one extra line per agent.
 */
export const AGENT_DEFINITIONS: AgentDefinition[] = [newUser];
