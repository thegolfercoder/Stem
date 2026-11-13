import type { NextConfig } from "next";

// A static export: every page is pre-rendered to HTML at build time, which is
// what makes the site indexable and lets it be hosted from any static bucket
// or CDN with no server. Interactivity lives in client components that hydrate
// on top of that HTML.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
