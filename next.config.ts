// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    dangerouslyAllowSVG: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "placehold.co",
      },
      // Add your real image CDN here later, e.g.:
      // { protocol: "https", hostname: "your-cdn.com" },
    ],
  },
};

export default nextConfig;
