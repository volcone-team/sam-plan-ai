import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/components/auth-provider";
import { ToastProvider } from "@/components/ui/toast";
import { DevtoolsDeterrent } from "@/components/devtools-deterrent";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import "./globals.css";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "SAM Plan AI",
  description: "The Revenue Operating System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={poppins.variable}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-background text-foreground font-sans antialiased">
        {/*
          ImpersonationBanner lives HERE, at the root, not in the (app) route
          group. The group misses /intake, /welcome, /choose-plan,
          /account-paused and /checkout, so an admin impersonating a customer
          through an intake saw no notice and had no Exit button. It is first in
          document order inside the providers, so it is the first thing both a
          screen reader and a sighted user meet, and it renders null (client
          cookie read, server snapshot "") on every normal session — no page is
          made dynamic by it. Suppressed on /auth/* by the component itself.
        */}
        <ThemeProvider><AuthProvider><ToastProvider><ImpersonationBanner /><DevtoolsDeterrent />{children}</ToastProvider></AuthProvider></ThemeProvider>
      </body>
    </html>
  );
}
