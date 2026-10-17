import type { Metadata } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";
import { ConfirmProvider } from "@/components/workspace/confirm-provider";

const dmSans = localFont({
  src: [
    { path: "../assets/fonts/DM-Sans-400.ttf", weight: "400", style: "normal" },
    { path: "../assets/fonts/DM-Sans-500.ttf", weight: "500", style: "normal" },
    { path: "../assets/fonts/DM-Sans-600.ttf", weight: "600", style: "normal" },
    { path: "../assets/fonts/DM-Sans-700.ttf", weight: "700", style: "normal" },
    {
      path: "../assets/fonts/DM-Sans-400-Italic.ttf",
      weight: "400",
      style: "italic",
    },
  ],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "INBIONUSA — Quality Control System",
  description: "INBIONUSA quality control workspace",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={dmSans.variable}>
      <body className="min-h-screen font-sans">
        <ConfirmProvider>{children}</ConfirmProvider>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
