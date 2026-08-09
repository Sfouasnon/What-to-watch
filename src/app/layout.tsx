import type { Metadata } from "next";
import type { Viewport } from "next";
import type { ReactNode } from "react";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "http://localhost:3000"),
  ),
  title: {
    default: "What to Watch — Your personal movie concierge",
    template: "%s · What to Watch",
  },
  description:
    "Ten thoughtful recommendations shaped by your taste, your mood, and what you can actually stream.",
  applicationName: "What to Watch",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "What to Watch",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    siteName: "What to Watch",
    title: "What to Watch — Your personal movie concierge",
    description:
      "Tell us the mood. Get ten considered picks — not another endless feed.",
    images: [{ url: "/og.jpg", width: 1200, height: 630, alt: "What to Watch — ten considered picks, one good night" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "What to Watch",
    description: "Ten considered picks for tonight.",
    images: ["/og.jpg"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#090a0b",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${manrope.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
