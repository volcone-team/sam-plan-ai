import type { ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";
import { AppHeader } from "@/components/header";
import { MobileNav } from "@/components/mobile-nav";
import { AppShell } from "@/components/app-shell";

interface AppLayoutProps {
  children: ReactNode;
}

/**
 * Application shell layout.
 * Wraps all authenticated/app pages with sidebar, header, and mobile nav.
 * Content area scrolls independently from the fixed sidebar.
 */
export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <AppShell
      sidebar={<Sidebar />}
      mobileNav={<MobileNav />}
      header={<AppHeader />}
    >
      {children}
    </AppShell>
  );
}
