import type { Metadata } from "next";
import "./globals.css";
import "./product-pages.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://sportpad.fun"),
  title: {
    default: "SportPad | Sports coins with Fan Token rewards",
    template: "%s · SportPad",
  },
  description: "Create private Solana community-token drafts and explore planned Fan Token rewards and SPORTPAD buybacks. Mainnet launches and financial execution are paused.",
  openGraph: {
    type: "website",
    url: "/",
    siteName: "SportPad",
    title: "SportPad | Sports coins with Fan Token rewards",
    description: "Explore private Solana launch drafts with official Fan Token reward planning and transparent SPORTPAD economics.",
  },
  twitter: {
    card: "summary_large_image",
    title: "SportPad | Sports coins with Fan Token rewards",
    description: "Private Solana launch drafts with official Fan Token reward planning and transparent SPORTPAD economics.",
  },
  other: {
    "theme-color": "#070a08",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
