import type { Metadata, Viewport } from "next";

import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "Expense Tracker",
  description:
    "A minimalist personal budget and expense tracker in Philippine Peso.",
  applicationName: "Expense Tracker",
  appleWebApp: {
    capable: true,
    title: "Expense Tracker",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#08090a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        {/* Tracker data is loaded per page, scoped to the signed-in user, so
            the provider lives with those routes rather than here. */}
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
