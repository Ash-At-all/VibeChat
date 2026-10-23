import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#151714",
};

export const metadata: Metadata = {
  title: {
    default: "VibeChat | City communities",
    template: "%s | VibeChat",
  },
  description:
    "Join city communities to share local posts, ask questions, and take part in topic-based chat.",
  applicationName: "VibeChat",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
