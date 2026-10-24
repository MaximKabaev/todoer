import type { NextConfig } from "next";
const api = (process.env.API_URL || "http://localhost:4000").replace(/\/$/, "");
const config: NextConfig = {
  devIndicators: false,
  experimental: { proxyClientMaxBodySize: "100mb" },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      { source: "/agent", destination: `${api}/api/agent` },
    ];
  },
};
export default config;
