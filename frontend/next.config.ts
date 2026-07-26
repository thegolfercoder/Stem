import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // The API base is read at build time so the client bundle can talk to a
  // backend on a different host in production.
  env: {
    NEXT_PUBLIC_API_BASE:
      process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000",
  },
};

export default config;
