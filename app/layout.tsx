import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "iDive AI — AI Business Presenter Videos",
  description:
    "Create presenter-led business videos with AI. Generate a presenter, script, voice and final MP4 for landing pages, product explainers, founder messages and sales outreach.",
  keywords: [
    "AI presenter",
    "AI spokesperson",
    "AI business video",
    "AI product explainer",
    "AI sales outreach video",
    "AI founder message",
    "AI video generator",
  ],
  openGraph: {
    title: "iDive AI — AI Business Presenter Videos",
    description:
      "Generate presenter-led business videos with AI. Create a presenter, refine the script in Studio, and render the final MP4 in minutes.",
    type: "website",
    url: "https://idive.ai",
  },
  twitter: {
    card: "summary_large_image",
    title: "iDive AI — AI Business Presenter Videos",
    description:
      "Create AI presenter videos for websites, product explainers, founder updates and sales outreach.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-black text-white`}>
        {children}
      </body>
    </html>
  );
}