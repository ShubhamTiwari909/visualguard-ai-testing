import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Acme · VisualGuard example",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white font-sans text-slate-900 antialiased">
        <header className="flex items-center justify-between border-b border-slate-200 px-8 py-4">
          <Link href="/" className="text-lg font-bold">
            Acme
          </Link>
          <nav className="flex gap-6 text-sm text-slate-600">
            <Link href="/">Home</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/checkout">Checkout</Link>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-8 py-10">{children}</main>
      </body>
    </html>
  );
}
