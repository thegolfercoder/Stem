import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // three is shipped as ESM with a large surface; transpiling keeps the
  // r3f/drei chain working under the app router's server component build.
  transpilePackages: ["three"],
  // Carbon Garage is a static app in public/garage; /garage opens its page.
  async redirects() {
    return [{ source: "/garage", destination: "/garage/index.html", permanent: false }];
  },
};

export default nextConfig;
