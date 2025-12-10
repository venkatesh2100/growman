import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // to fix the Cloudflare Deploy Erros
   transpilePackages: ['@repo/ui'],
};

export default nextConfig;
