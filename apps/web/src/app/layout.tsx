import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AMBURAX POS",
  description: "Retail operating system for physical and online commerce.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
