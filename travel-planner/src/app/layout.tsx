import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Roamio",
  description: "Personal trip planner grounded in real flight, hotel, and activity data.",
  robots: { index: false, follow: false },
  // Lets "Add to Home Screen" open Roamio full-screen like a native app.
  appleWebApp: { capable: true, title: "Roamio", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-US">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
