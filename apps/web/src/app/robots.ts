import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [
          "/app",
          "/admin",
          "/api/",
          "/verify-email",
          "/setup-profile",
          "/onboarding",
          "/level",
          "/placement-test",
          "/assessment-results",
        ] }],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
