import type { ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";
import { AppHeader } from "@/components/header";
import { MobileNav } from "@/components/mobile-nav";
import { AppShell } from "@/components/app-shell";
import { ChatWidget } from "@/components/chat/chat-widget";

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
    <>
      {/*
        The impersonation banner used to be mounted here. It now lives in the
        ROOT layout (src/app/layout.tsx) so it also covers /intake, /welcome,
        /choose-plan and every future layout outside this group. Do not add a
        second mount — it would render the notice twice on these pages.
      */}
      <AppShell
        sidebar={<Sidebar />}
        mobileNav={<MobileNav />}
        header={<AppHeader />}
      >
        {children}
      </AppShell>
      {/*
        Mounted at the layout level, OUTSIDE AppShell, so the widget persists
        across page navigations within the app — remounting per page would drop
        the open/minimised state on every route change. It renders null unless a
        super admin has enabled chat.
      */}
      <ChatWidget />
    </>
  );
}
