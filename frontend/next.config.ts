import type { NextConfig } from "next";

const apiOrigin = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";
const isDevelopment = process.env.NODE_ENV === "development";
const isVercel = process.env.VERCEL === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: isDevelopment ? ".next-dev" : ".next",
  ...(!isVercel && { output: "standalone" }),
  outputFileTracingRoot: process.cwd(),
  async rewrites() {
    if (!isDevelopment) return [];
    return [
      {
        source: "/api/backend/:path*",
        destination: `${apiOrigin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
