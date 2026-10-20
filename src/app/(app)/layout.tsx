import type { ReactNode } from "react";
import { ImpersonationBanner } from "@/components/impersonation-banner";
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
        ABOVE AppShell and in the normal document flow, so it pushes the
        sidebar and content down rather than overlaying them — an admin must
        never lose a control to the banner, and must never miss the banner.
        It renders null when the impersonation marker cookie is absent, which
        is every normal customer session.

        The ImpersonationProvider that used to wrap this tree is gone: that
        context was the old sessionStorage mechanism. Impersonation state now
        comes from a server-set, signed cookie.
      */}
      <ImpersonationBanner />
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
