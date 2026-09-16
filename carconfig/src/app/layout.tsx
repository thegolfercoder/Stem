import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Carbon — vehicle build configurator",
    template: "%s — Carbon",
  },
  description:
    "Pick a car, configure aftermarket parts, and find out what actually fits before you buy it.",
};

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-line)] bg-[var(--color-base)]/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1800px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold tracking-tight">Carbon</span>
          <span className="hidden text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink-faint)] sm:inline">
            Build configurator
          </span>
        </Link>

        <nav className="ml-auto flex items-center gap-1 text-[13px]">
          <Link
            href="/"
            className="rounded px-3 py-1.5 text-[var(--color-ink-dim)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
          >
            Vehicles
          </Link>
          <Link
            href="/builds"
            className="rounded px-3 py-1.5 text-[var(--color-ink-dim)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
          >
            Saved builds
          </Link>
          <Link
            href="/data"
            className="rounded px-3 py-1.5 text-[var(--color-ink-dim)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
          >
            Data quality
          </Link>
        </nav>
      </div>
    </header>
  );
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
