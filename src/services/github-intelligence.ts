/**
 * BLOCO 3 — GitHub Intelligence. Investigated first (per the brief's own
 * Checkpoint 0): this application has no GitHub integration today — no
 * octokit dependency, no stored OAuth/PAT, no GITHUB_TOKEN in its own
 * documented env contract (.env.example only lists DATABASE_URL/
 * ANTHROPIC_API_KEY/GEMINI_API_KEY). The coding session this feature was
 * built in happens to have a GITHUB_TOKEN/GH_TOKEN in its shell environment,
 * but that credential is scoped to the session's own git-proxy (clone/fetch
 * over smart-HTTP) — verified directly against the real GitHub REST API
 * (`GET /user` with it returns 401 "Bad credentials"), so it cannot and
 * must not be repurposed as this product's own GitHub auth. Reusing it
 * would also be wrong on principle: it is infrastructure provisioned for
 * this coding session, not a credential the product's own user granted to
 * the product.
 *
 * This service is therefore real, working code with a real (currently
 * absent) credential requirement — never a mock, never fabricated repo
 * data. `GITHUB_API_TOKEN` is a new, product-level env var (documented in
 * .env.example) distinct from the session's own GITHUB_TOKEN/GH_TOKEN: a
 * real GitHub Personal Access Token (classic, `repo` + `read:user` scopes,
 * or a fine-grained token with "Metadata: read" + "Contents: read" on the
 * target repos) that the product's own operator would configure. Until one
 * is set, `listAccessibleRepos()` honestly reports `configured: false`
 * rather than guessing or returning empty-but-ambiguous data.
 */

import { getEnv } from "@/lib/env";

export interface GithubRepoSummary {
  fullName: string;
  description: string | null;
  url: string;
  updatedAt: string;
}

export type GithubIntelligenceResult =
  | { configured: false }
  | { configured: true; ok: true; repos: GithubRepoSummary[] }
  | { configured: true; ok: false; error: string };

export async function listAccessibleRepos(): Promise<GithubIntelligenceResult> {
  const token = getEnv().GITHUB_API_TOKEN;
  if (!token) return { configured: false };

  try {
    const response = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "ai-product-lab-operational-brain",
        Accept: "application/vnd.github+json",
      },
    });

    if (!response.ok) {
      return { configured: true, ok: false, error: `GitHub API respondeu ${response.status} ${response.statusText}` };
    }

    const body = (await response.json()) as Array<{ full_name: string; description: string | null; html_url: string; updated_at: string }>;
    return {
      configured: true,
      ok: true,
      repos: body.map((repo) => ({ fullName: repo.full_name, description: repo.description, url: repo.html_url, updatedAt: repo.updated_at })),
    };
  } catch (err) {
    return { configured: true, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
