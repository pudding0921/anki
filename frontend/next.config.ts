import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  // turbopack.root silences the workspace-root warning in local dev only
  ...(process.env.NODE_ENV === "development" && {
    turbopack: { root: __dirname },
  }),
};

export default nextConfig;
