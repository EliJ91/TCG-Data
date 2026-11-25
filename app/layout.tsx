import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SortSwift Market",
  description:
    "A focused inventory workbench for TCGplayer pricing, demand, and listing decisions.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body className="antialiased"><script dangerouslySetInnerHTML={{__html:`try{document.documentElement.dataset.theme=localStorage.getItem('sortswift-theme')||'dark'}catch{}`}}/>{children}</body>
    </html>
  );
}
