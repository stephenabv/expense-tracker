import { execSync } from "node:child_process";

import type { NextConfig } from "next";

/**
 * The commit this build came from, for the footer's build identifier.
 *
 * Vercel injects the SHA; locally it comes from git. Either way it is resolved
 * once here rather than at runtime, so no request ever shells out. A failure is
 * not an error — the footer simply omits the build and shows the version alone.
 */
function resolveBuildId(): string {
  const fromCi = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA;
  if (fromCi) return fromCi.slice(0, 7);

  try {
    return execSync("git rev-parse --short=7 HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Public build metadata only: a seven-character commit prefix of a public
  // repository. Nothing about the environment, the branch or the deployment.
  env: { NEXT_PUBLIC_BUILD_ID: resolveBuildId() },

  /*
   * Loaded from node_modules at runtime rather than bundled.
   *
   * `@node-rs/argon2` and `pg` ship native bindings, and `@electric-sql/pglite`
   * ships a WASM payload — the bundler cannot trace those companion files, so
   * bundling them produces a server that starts and then fails on first use.
   * `nodemailer` resolves several of its own modules dynamically for the same
   * reason.
   */
  serverExternalPackages: [
    "@node-rs/argon2",
    "pg",
    "@electric-sql/pglite",
    "nodemailer",
  ],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Verification and reset links must not leak through a referrer to
          // any third party the user navigates to next.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
