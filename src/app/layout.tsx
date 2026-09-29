import type { Metadata } from "next";
import "./globals.css";
import { APP_NAME } from "@/lib/utils";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Shared inbox for support mail",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
