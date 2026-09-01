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


const geist = Geist({ subsets: ["latin"] });
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  weight: ["500", "600", "700"],
});

/* ---------------- METADATA ---------------- */
export const metadata: Metadata = {
  title: "Growman - Plant Store",
  description: "Your favorite plant store - shop plants online",

  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Growman",
  },

  icons: {
    apple: "/icons/icon-192x192.png",
  },

  manifest: "/manifest.json",

  other: {
    "google-play-app": "app-id=com.venky2100.growman",
  },
};

/* ---------------- VIEWPORT ---------------- */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#059669",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head />
      <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-49FZDEFB2Y"
          strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'G-49FZDEFB2Y');
        `}
      </Script>

      <body
        className={`${geist.className} ${spaceGrotesk.variable} bg-linear-to-r from-green-50 to-emerald-50`}
      >
        <ServiceWorkerRegistration />
        <BrowseEngagementBeacon />
        <Navbar />
        {children}
        <PlantChatbot />
        <ToastContainer />
        <InstallPrompt />
      </body>
    </html>
  );
}
