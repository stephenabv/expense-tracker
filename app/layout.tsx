import type { Metadata, Viewport } from "next";

import { ToastProvider } from "@/components/ui/Toast";
import { Footer } from "@/components/layout/Footer";
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
        <ToastProvider>
          {children}

          {/*
            * The footer lives here rather than in the page shells.
            *
            * A route's loading skeleton and its page can be mounted at the same
            * moment while Next streams, so anything a shell renders can appear
            * twice. Rendering it once per document keeps a single `contentinfo`
            * landmark whatever is happening above it.
            */}
          <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
            <Footer />
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
