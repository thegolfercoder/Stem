import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // three is shipped as ESM with a large surface; transpiling keeps the
  // r3f/drei chain working under the app router's server component build.
  transpilePackages: ["three"],
};

export default nextConfig;
