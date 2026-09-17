"use client";

import type { ReactNode } from "react";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LogOut, ShieldCheck } from "lucide-react";
import { AdminSidebar } from "@/components/admin";
import { ThemeToggle } from "@/components/theme-toggle";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cacheClearAll } from '@/lib/client-cache';

interface AdminLayoutProps {
  children: ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  const { firstName } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSignOut = async () => {
    const supabase = createClient();
    // Drop cached profile/plan data so the next user never sees it.
    cacheClearAll();
    await supabase.auth.signOut();
    router.push("/admin-login");
  };

  const initial = firstName ? firstName.charAt(0).toUpperCase() : "A";

  return (
    <div className="relative min-h-dvh">
      <AdminSidebar />

      <div className="flex min-h-dvh flex-col lg:pl-[260px]">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card px-6">
          <div className="lg:hidden w-10" />
          <div className="hidden lg:block" />

          <div className="flex items-center gap-3">
            <ThemeToggle />

            {/* Admin avatar with dropdown */}
            <div ref={ref} className="relative">
              <button
                onClick={() => setOpen(!open)}
                aria-label="Admin menu"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-sm font-medium text-white cursor-pointer hover:opacity-90 transition-opacity"
              >
                {initial}
              </button>

              {open && (
                <div className="absolute right-0 top-full mt-2 w-44 rounded-[var(--radius-lg)] border border-border bg-card shadow-lg z-50 overflow-hidden">
                  <div className="px-3 py-2.5 border-b border-border flex items-center gap-2">
                    <ShieldCheck className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
                    <span className="text-xs font-semibold text-[hsl(var(--foreground-muted))]">Admin</span>
                  </div>
                  <div className="py-1">
                    <button
                      onClick={handleSignOut}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
