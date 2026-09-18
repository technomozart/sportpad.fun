import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SportPad — Sports coins with fan-token rewards",
  description: "Launch sports-native coins on Solana and turn creator fees into transparent fan-token rewards.",
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
