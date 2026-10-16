import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://carbontrack.vercel.app";

export const metadata: Metadata = {
  title: "CarbonTrack — Junction CO₂ Ops",
  description:
    "Municipal traffic-carbon operations console: live CO₂ telemetry from CCTV vehicle tracking, AI signal directives, and what-if policy simulation for the Junction 01 corridor.",
  metadataBase: new URL(APP_URL),
  applicationName: "CarbonTrack",
  keywords: ["traffic", "carbon", "telemetry", "signal control", "CCTV", "operations"],
  openGraph: {
    type: "website",
    title: "CarbonTrack — Junction CO₂ Ops",
    description:
      "Live CO₂ telemetry from CCTV vehicle tracking, AI signal directives and what-if policy simulation.",
    siteName: "CarbonTrack",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "CarbonTrack — Junction CO₂ Ops",
    description:
      "Live CO₂ telemetry from CCTV vehicle tracking, AI signal directives and what-if policy simulation.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0d0e",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
