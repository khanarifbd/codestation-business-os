import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { SessionActivityTracker } from "@/components/session-activity-tracker";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "CodeStation AI Business OS",
    template: "%s | CodeStation AI Business OS",
  },
  description: "One operating system to run your business.",
  icons: {
    icon: "/brand/codestationai-mark.svg?v=2",
    shortcut: "/brand/codestationai-mark.svg?v=2",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground"><SessionActivityTracker />{children}</body>
    </html>
  );
}
