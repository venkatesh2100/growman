import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    domains: ['images.unsplash.com','unsplash.com','mybageecha.com',"floridaseeds.net","treeworldwholesale.com","m.media-amazon.com","encrypted-tbn0.gstatic.com"],
  },
  output: "standalone",
};

export default nextConfig;
