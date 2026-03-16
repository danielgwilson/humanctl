import type { Metadata } from "next";
import { Fira_Code, Space_Grotesk } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const display = Fira_Code({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display"
});

const sans = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-sans"
});

export const metadata: Metadata = {
  title: "humanctl | A control plane for the human bottleneck.",
  description:
    "humanctl helps agents surface context, ask better questions, collect answers, and resume work without getting stuck on humans."
};

const themeInitScript = `
  (() => {
    try {
      const storedTheme = window.localStorage.getItem("humanctl-theme");
      const resolvedTheme =
        storedTheme === "light" || storedTheme === "dark"
          ? storedTheme
          : window.matchMedia("(prefers-color-scheme: light)").matches
            ? "light"
            : "dark";

      document.documentElement.dataset.theme = resolvedTheme;
      document.documentElement.style.colorScheme = resolvedTheme;
    } catch {}
  })();
`;

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${display.variable} ${sans.variable}`}>
        <Script id="humanctl-theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
        {children}
      </body>
    </html>
  );
}
