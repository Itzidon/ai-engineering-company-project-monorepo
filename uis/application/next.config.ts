
import type { NextConfig } from "next";
import path from "node:path";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  agentRules: false,
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },

  async rewrites() {
    return [
      {
        source: "/telemetry/:path*",
        destination: `${API_URL}/telemetry/:path*`,
      },
      {
        source: "/inventory/:path*",
        destination: `${API_URL}/inventory/:path*`,
      },
      {
        source: "/api/:path*",
        destination: `${API_URL}/api/:path*`,
      },
      {
        source: "/auth/:path*",
        destination: `${API_URL}/auth/:path*`,
      },
      {
        source: "/users/:path*",
        destination: `${API_URL}/users/:path*`,
      },
      {
        source: "/profiles/:path*",
        destination: `${API_URL}/profiles/:path*`,
      },
    ];
  },
};

export default nextConfig;
