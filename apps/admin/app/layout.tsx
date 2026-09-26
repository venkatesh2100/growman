import "@repo/ui/styles.css";
import "./globals.css";
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import AdminNavbar from "../components/AdminNavbar";
import AdminAuthGate from "../components/AdminAuthGate";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Growman Admin",
  description: "Growman admin panel",
  // The admin panel must never appear in search results, and crawlers should
  // not follow links deeper into it. This is belt-and-braces alongside
  // app/robots.ts, which disallows the whole host.
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={geist.className}>
        <AdminAuthGate>
          <AdminNavbar />
          {children}
        </AdminAuthGate>
      </body>
    </html>
  );
}
