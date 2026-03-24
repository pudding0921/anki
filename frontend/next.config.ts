import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  // turbopack.root silences the workspace-root warning in local dev only
  ...(process.env.NODE_ENV === "development" && {
    turbopack: { root: __dirname },
  }),
  async headers() {
    return [
      {
        // Prevent browsers from caching API responses
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
    ];
  },
};

export default nextConfig;
