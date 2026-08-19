import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

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
