import path from "node:path";

import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

const monorepoRoot = path.resolve(__dirname, "../..");

// One .env at the monorepo root configures API, web and docker compose alike.
loadEnvConfig(monorepoRoot);

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Microphone stays available to this origin for speaking practice.
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  transpilePackages: ["@engora/types", "@engora/ui", "@engora/validation"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  /**
   * The Owner Console's information architecture changed: the content types moved under
   * Content CMS, and "Settings" split into the Learner App's configuration and the
   * console's own. Bookmarks, links in old notes and anything an operator pinned still
   * work — temporary redirects, because these are our own URLs and not something search
   * engines should be told is permanent.
   */
  async redirects() {
    return [
      { source: "/owner/cms", destination: "/owner/content/all", permanent: false },
      { source: "/owner/cms/grammar", destination: "/owner/content/grammar", permanent: false },
      { source: "/owner/cms/grammar/:path*", destination: "/owner/content/grammar/:path*", permanent: false },
      { source: "/owner/assessments", destination: "/owner/content/placement", permanent: false },
      { source: "/owner/questions", destination: "/owner/content/question-bank", permanent: false },
      // Shipped briefly as /questions before the tree settled on the fuller name.
      { source: "/owner/content/questions", destination: "/owner/content/question-bank", permanent: false },
    ];
  },
};

export default nextConfig;
