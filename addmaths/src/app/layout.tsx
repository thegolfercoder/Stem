import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SITE } from "@/lib/site";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ThemeScript } from "@/components/ThemeScript";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.longName} — complete revision course`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  keywords: [
    "IGCSE Additional Mathematics",
    "0606",
    "Add Maths revision",
    "Cambridge IGCSE 0606 notes",
    "Additional Mathematics past paper questions",
  ],
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: `${SITE.longName} — complete revision course`,
    description: SITE.description,
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1017" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-[color:var(--bg-card)] focus:px-4 focus:py-2 focus:shadow-lg"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
