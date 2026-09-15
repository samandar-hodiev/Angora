import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

const publicPaths = ["", "/features", "/speaking", "/writing", "/reading", "/listening", "/ielts", "/pricing", "/about", "/faq", "/blog", "/contact"];

export default function sitemap(): MetadataRoute.Sitemap {
  return publicPaths.map((path) => ({
    url: `${siteUrl}${path}`,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : 0.7,
  }));
}
