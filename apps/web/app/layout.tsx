import "@repo/ui/styles.css";
import "./globals.css";
import type { Metadata } from "next";
import { Geist } from "next/font/google";
// import Navbar from "@repo/ui/navbar";
import Navbar from "../components/hompage/navbar";
import { ToastContainer } from "../lib/toast";
import ServiceWorkerRegistration from "../components/pwa/ServiceWorkerRegistration";
import InstallPrompt from "../components/pwa/InstallPrompt";

// import { SessionProvider } from "next-auth/react";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Growman - Plant Store",
  description: "Your favorite plant store - shop plants online",
  manifest: "/manifest.json",
  themeColor: "#059669",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Growman",
  },
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
  },
  icons: {
    apple: "/icons/icon-192x192.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#059669" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Growman" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="format-detection" content="telephone=no" />
      </head>
      <body
        className={`${geist.className} bg-linear-to-r from-green-50 to-emerald-50`}
      >
        <ServiceWorkerRegistration />
        <div className="z-100">
          <Navbar />
        </div>
        {children}
        <ToastContainer />
        <InstallPrompt />
      </body>
    </html>
  );
}
