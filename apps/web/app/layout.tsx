import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";
export const metadata: Metadata = {
  openGraph: {
    title: "todoer",
    description: "A calm place for your tasks. Built for two.",
  },
  twitter: {
    card: "summary",
    title: "todoer",
    description: "A calm place for your tasks. Built for two.",
  },
  description: "A calm place for your tasks. Built for two.",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "todoer" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#17191d" },
  ],
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
