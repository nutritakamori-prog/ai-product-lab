import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stops the framework from being identified via the X-Powered-By response
  // header (OWASP ZAP: "Server Leaks Information via X-Powered-By").
  poweredByHeader: false,

  // The two other ZAP-confirmed header gaps, fixed centrally for every
  // route. A real Content-Security-Policy is NOT included here: this app's
  // rendered HTML genuinely relies on inline <script> tags for the App
  // Router's RSC hydration payload (self.__next_f.push(...), confirmed by
  // inspecting a live response) — a strict script-src without 'unsafe-inline'
  // would break hydration. Doing this properly needs a per-request nonce via
  // middleware.ts (Next's documented CSP pattern), which is a new file/new
  // mechanism, not a header tweak — out of scope here, see docs/DECISIONS.md.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Anti-clickjacking (ZAP: "Missing Anti-clickjacking Header").
          { key: "X-Frame-Options", value: "DENY" },
          // ZAP: "X-Content-Type-Options Header Missing".
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
