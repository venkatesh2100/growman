import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'mybageecha.com',
      },
      {
        protocol: 'https',
        hostname: 'floridaseeds.net',
      },
      {
        protocol: 'https',
        hostname: 'treeworldwholesale.com',
      },
      {
        protocol: 'https',
        hostname: 'm.media-amazon.com',
      },
      {
        protocol: 'https',
        hostname: 'encrypted-tbn0.gstatic.com',
      },
      {
        protocol: 'https',
        hostname: 'www.toothmountainnursery.com',
      },
    ],
  },
  output: "standalone",
};

export default nextConfig;
