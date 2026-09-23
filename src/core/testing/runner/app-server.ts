import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

export interface AppServerHandle {
  baseUrl: string;
  close(): Promise<void>;
}

const NEXT_BIN = path.join(process.cwd(), "node_modules", ".bin", "next");
const READY_TIMEOUT_MS = 20_000;

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Could not determine a free port")));
      }
    });
  });
}

async function waitUntilReady(baseUrl: string, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok || response.status < 500) return;
    } catch {
      // not up yet — keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`App server did not respond at ${baseUrl} within ${READY_TIMEOUT_MS}ms.`);
}

/**
 * Starts the REAL Next.js production server (`next start`, against the
 * existing `.next` build — not `next dev`) on a free port, for the
 * PlaywrightBrowserAdapter to navigate against. Deliberately does not build
 * on demand: two test files can start a server concurrently (vitest runs
 * files in parallel), and two concurrent `next build`s writing the same
 * `.next` directory would corrupt each other. `next start` only reads the
 * existing build, which is safe to do concurrently — so a build must
 * already exist (run `npm run build` first) or this throws immediately.
 *
 * Owns the child process fully: `close()` kills the whole process group
 * (not just the top-level `next` process, which can itself have children)
 * and waits for it to actually exit, so nothing is left running after a
 * test finishes.
 */
export async function startAppServer(): Promise<AppServerHandle> {
  try {
    await access(path.join(process.cwd(), ".next", "BUILD_ID"));
  } catch {
    throw new Error(
      'No production build found at ".next". Run "npm run build" before running browser-driven scenarios or tests.',
    );
  }

  const port = await getFreePort();
  const baseUrl = `http://localhost:${port}`;

  let output = "";
  const child = spawn(NEXT_BIN, ["start", "-p", String(port)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // own process group, so close() can kill the whole tree
  });
  child.stdout?.on("data", (chunk) => (output += String(chunk)));
  child.stderr?.on("data", (chunk) => (output += String(chunk)));

  const exitedEarly = new Promise<never>((_, reject) => {
    child.once("exit", (code) => {
      reject(new Error(`next start exited early (code ${code}). Output:\n${output}`));
    });
  });

  try {
    await Promise.race([waitUntilReady(baseUrl, Date.now() + READY_TIMEOUT_MS), exitedEarly]);
  } catch (err) {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
    throw err;
  }

  return {
    baseUrl,
    async close() {
      if (!child.pid || child.exitCode !== null) return;
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        try {
          process.kill(-child.pid!, "SIGTERM");
        } catch {
          resolve();
          return;
        }
        setTimeout(() => {
          try {
            process.kill(-child.pid!, "SIGKILL");
          } catch {
            // already gone
          }
        }, 5000).unref();
      });
    },
  };
}
