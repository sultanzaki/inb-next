import type { Metadata } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ConfirmProvider } from "@/components/workspace/confirm-provider";

const dmSans = localFont({
  src: [
    {
      path: "../assets/fonts/DM-Sans-400.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../assets/fonts/DM-Sans-500.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../assets/fonts/DM-Sans-600.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../assets/fonts/DM-Sans-700.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "../assets/fonts/DM-Sans-400-Italic.woff2",
      weight: "400",
      style: "italic",
    },
  ],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "INBIONUSA — Operations workspace",
    template: "%s | INBIONUSA",
  },
  applicationName: "INBIONUSA",
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
  description:
    "Secure operations workspace for PT Inovasi Biokem Nusantara. Manage production, quality, inventory, purchasing, CRM and sales.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={dmSans.variable}>
      <body className="min-h-screen font-sans">
        <ThemeProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
          <Toaster position="top-right" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
