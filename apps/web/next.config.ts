import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    // Serve AVIF/WebP at the display size instead of streaming full originals
    // from Azure/GCS (which paints progressive JPEG top→bottom).
    formats: ["image/avif", "image/webp"],
    // Fewer widths = fewer distinct variants to transform and a higher edge
    // cache hit rate. Stored originals are capped at 1600px by the backend.
    deviceSizes: [384, 640, 828, 1080, 1200, 1600],
    imageSizes: [32, 48, 64, 96, 128, 256],
    qualities: [75],
    minimumCacheTTL: 60 * 60 * 24 * 30,
    dangerouslyAllowLocalIP: process.env.NODE_ENV === "development",
    remotePatterns: [
      {
        protocol: "https",
        hostname: "growman.blob.core.windows.net",
        pathname: "/growman/**",
      },
      {
        protocol: "https",
        hostname: "*.blob.core.windows.net",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
        pathname: "/**",
      },
    ],
  },
  output: "standalone",
  // Ensure service worker is served with correct headers
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Clickjacking protection only. A full script CSP would need nonces
          // for GA, Turnstile and inline JSON-LD, so it is not declared here.
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          // Allows OAuth/payment popups while isolating the browsing context.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Camera and microphone stay available to the site's own plant scan
          // and voice search.
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=(self)",
          },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
          {
            key: 'Service-Worker-Allowed',
            value: '/',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
