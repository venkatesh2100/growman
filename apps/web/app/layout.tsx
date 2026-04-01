import "@repo/ui/styles.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import Navbar from "../components/hompage/navbar";
import { ToastContainer } from "../lib/toast";
import ServiceWorkerRegistration from "../components/pwa/ServiceWorkerRegistration";
import InstallPrompt from "../components/pwa/InstallPrompt";
import PlantChatbot from "../components/chatbot/PlantChatbot";

const geist = Geist({ subsets: ["latin"] });

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
      <body
        className={`${geist.className} bg-linear-to-r from-green-50 to-emerald-50`}
      >
        <ServiceWorkerRegistration />
        <Navbar />
        {children}
        <PlantChatbot />
        <ToastContainer />
        <InstallPrompt />
      </body>
    </html>
  );
}
