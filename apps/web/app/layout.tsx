import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lethe — sealed-order trading on Elysium",
  description:
    "Trade without being front-run. Orders stay sealed until the round closes, then everyone fills at one fair price.",
};

export const viewport: Viewport = { themeColor: "#06070c", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <div className="river" aria-hidden />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
