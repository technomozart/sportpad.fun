import type { Metadata } from "next";
import "./globals.css";
import "./product-pages.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://sportpad.fun"),
  title: {
    default: "SportPad — Sports coins with fan-token rewards",
    template: "%s · SportPad",
  },
  description: "Launch sports-native coins on Solana and turn creator fees into transparent fan-token rewards.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "SportPad",
    title: "SportPad — Sports coins with fan-token rewards",
    description: "Explore a transparent Solana launchpad concept for sports community coins and verified fan-token rewards.",
  },
  twitter: {
    card: "summary_large_image",
    title: "SportPad — Sports coins with fan-token rewards",
    description: "A transparent Solana launchpad concept for sports community coins and verified fan-token rewards.",
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
