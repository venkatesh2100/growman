import "@repo/ui/styles.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Geist, Space_Grotesk } from "next/font/google";
import Script from "next/script";
import Navbar from "../components/hompage/navbar";
import { ToastContainer } from "../lib/toast";
import ServiceWorkerRegistration from "../components/pwa/ServiceWorkerRegistration";
import InstallPrompt from "../components/pwa/InstallPrompt";
import PlantChatbot from "../components/chatbot/PlantChatbot";
import BrowseEngagementBeacon from "../components/BrowseEngagementBeacon";
import Footer from "../components/hompage/footer";
import HideOnRoutes from "../components/layout/HideOnRoutes";
import JsonLd from "../components/seo/JsonLd";
import { siteConfig } from "../lib/seo/site";
import { absoluteUrl } from "../lib/seo/metadata";
import {
  createOrganizationJsonLd,
  createWebSiteJsonLd,
} from "../lib/seo/jsonLd";


const geist = Geist({ subsets: ["latin"] });

/** Routes that run without footer, assistant or install banner competing for attention. */
const FOCUSED_ROUTES = ["/checkout"] as const;
/** Routes with a sticky mobile action bar that floating widgets would cover. */
const STICKY_BAR_ROUTES = ["/checkout", "/cart"] as const;
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  weight: ["500", "600", "700"],
});

/* ---------------- METADATA ---------------- */
export const metadata: Metadata = {
  // Makes every relative `alternates.canonical` and OG image across the app
  // resolve to an absolute https://growman.live URL.
  metadataBase: new URL(siteConfig.url),

  title: {
    default: siteConfig.title,
    // Page-level titles supply only their own part; the brand is appended once.
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,

  // No default `alternates.canonical` here on purpose. Metadata is inherited,
  // so setting one would make every page that does not override it — including
  // noindex routes like /search, /login and /checkout — canonicalise to the
  // homepage. Each indexable page declares its own canonical instead.

  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },

  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    title: siteConfig.title,
    description: siteConfig.description,
    url: siteConfig.url,
    locale: siteConfig.locale,
    images: [
      {
        url: absoluteUrl(siteConfig.ogImage),
        alt: `${siteConfig.name} — plants online in India`,
      },
    ],
  },

  twitter: {
    card: "summary_large_image",
    title: siteConfig.title,
    description: siteConfig.description,
    images: [absoluteUrl(siteConfig.ogImage)],
  },

  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Growman",
  },

  icons: {
    icon: [
      // No SVG favicon: /icons/favicon.svg is a ~1 MB embedded PNG that
      // competed with the hero image for bandwidth on mobile.
      { url: "/icons/favicon.ico", sizes: "48x48" },
      { url: "/icons/icon-192x192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: "/icons/icon-192x192.png",
  },

  manifest: "/manifest.json",

  other: {
    "google-play-app": "app-id=com.venky2100.growman",
  },

  // Search Console verification is opt-in via env var so no placeholder token
  // is ever shipped. See docs/SEO.md for the DNS/HTML alternatives.
  ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? {
        verification: {
          google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
        },
      }
    : {}),
};

/* ---------------- VIEWPORT ---------------- */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom is left enabled: locking it fails the WCAG 1.4.4 resize
  // requirement and is flagged by Lighthouse accessibility audits.
  viewportFit: "cover",
  themeColor: "#059669",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-IN">
      <head>
        {/* Site-wide entities, declared once and referenced by @id elsewhere. */}
        <JsonLd
          id="site-jsonld"
          data={[createOrganizationJsonLd(), createWebSiteJsonLd()]}
        />
      </head>

      <body
        className={`${geist.className} ${spaceGrotesk.variable} bg-linear-to-r from-green-50 to-emerald-50 text-gray-800 antialiased`}
      >
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-49FZDEFB2Y"
          strategy="lazyOnload"
        />
        <Script id="google-analytics" strategy="lazyOnload">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-49FZDEFB2Y');
          `}
        </Script>
        <ServiceWorkerRegistration />
        <BrowseEngagementBeacon />
        <Navbar />
        {children}
        <HideOnRoutes routes={FOCUSED_ROUTES}>
          <Footer />
        </HideOnRoutes>
        <HideOnRoutes routes={STICKY_BAR_ROUTES}>
          <PlantChatbot />
          <InstallPrompt />
        </HideOnRoutes>
        <ToastContainer />
      </body>
    </html>
  );
}
