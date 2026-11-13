import type { MetadataRoute } from "next";
import { TOPICS } from "@/content/topics";
import { NAV, SITE } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages = NAV.map((n) => ({
    url: `${SITE.url}${n.href}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: n.href === "/" ? 1 : 0.8,
  }));
  const topics = TOPICS.map((t) => ({
    url: `${SITE.url}/topics/${t.slug}/`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));
  const summaries = TOPICS.filter((t) => t.summary).map((t) => ({
    url: `${SITE.url}/topics/${t.slug}/summary/`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));
  return [...pages, ...topics, ...summaries];
}
