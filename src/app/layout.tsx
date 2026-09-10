import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";

import { Toaster } from "@/components";

import { AuthStatus } from "./components";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "opsz"],
});

export const metadata: Metadata = {
  title: "Gift I Need",
  description: "Share one link, get gifts you actually want.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* NOTE: AuthStatus calls getUser() -> cookies(), a request-time API, in
            the ROOT layout — which opts every route in the app into dynamic
            rendering. Accepted: wrangler.jsonc records R2 incremental caching as
            deferred and no route uses revalidate/ISR, so there is no static
            output to lose. Revisit if a marketing page is ever added. */}
        <header className="flex justify-end border-b px-6 py-3">
          <AuthStatus />
        </header>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
