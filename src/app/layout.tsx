import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#141412",
};

export const metadata: Metadata = {
  title: {
    default: "VibeChat | City communities",
    template: "%s | VibeChat",
  },
  description:
    "Join city communities to share local posts, ask questions, and take part in topic-based chat.",
  applicationName: "VibeChat",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "VibeChat",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "VibeChat | City communities",
    description: "Share local posts, ask questions, and join city conversations.",
    siteName: "VibeChat",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
