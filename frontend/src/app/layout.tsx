import type { Metadata, Viewport } from "next";

import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reverse Desmos",
  description:
    "Reconstruct mathematics from a sketch, a screenshot or a spreadsheet.",
};

export const viewport: Viewport = {
  themeColor: "#0b0c0e",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
