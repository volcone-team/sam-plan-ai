"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { User, LogOut, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cacheClearAll } from '@/lib/client-cache';
import { revokeDeviceTrust } from '@/lib/sign-out';

export interface UserAvatarProps {
  /** User's display name (for initials fallback and aria-label) */
  name?: string;
  /** Avatar image URL */
  imageUrl?: string;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeMap = {
  sm: "h-7 w-7 text-xs",
  md: "h-8 w-8 text-sm",
  lg: "h-10 w-10 text-base",
} as const;

/**
 * User avatar with dropdown menu.
 * Shows initials or user icon. Clicking opens menu with profile link and sign out.
 */
export function UserAvatar({
  name,
  imageUrl,
  size = "md",
  className,
}: UserAvatarProps) {
  const [open, setOpen] = useState(false);
  const { firstName, lastName, email } = useAuth();

  // Prefer the profiles row (source of truth), then an explicit prop, then email.
  const userName =
    name ||
    `${firstName ?? ""} ${lastName ?? ""}`.trim() ||
    email ||
    "";

  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    const supabase = createClient();
    // Drop cached profile/plan data so the next user never sees it.
    cacheClearAll();
    // Also drop any anonymous questionnaire draft. It is not user-scoped, so
    // leaving it behind let the next account in this browser inherit it.
    try { localStorage.removeItem('sam-plan-data'); } catch {}
    // Revoke two-factor device trust BEFORE ending the session: the revoke
    // endpoint is exempt from the middleware gate, but clearing cookies while
    // the session is already being torn down is needlessly racy. `sam_2fa` is
    // httpOnly, so this server round trip is the only way to delete it —
    // without it the next account signing in on this browser would inherit
    // trust and skip the code challenge entirely.
    await revokeDeviceTrust();
    /**
     * `scope: 'local'` — ends THIS browser's session only.
     *
     * auth-js defaults to `scope: 'global'`, which revokes every refresh token
     * the account holds and signs the user out on every device they are signed
     * in on. Signing out on a laptop was therefore kicking the same person out
     * of their phone and their other browser, which reads as the app dropping
     * sessions at random. Device trust is already per-browser (`sam_2fa` is
     * revoked just above), so local scope is the matching behaviour.
     */
    await supabase.auth.signOut({ scope: 'local' });
    router.push("/auth/login");
  };

  // First initial of the first name.
  const initials = userName ? userName.trim().charAt(0).toUpperCase() : null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-label={userName ? `${userName}'s menu` : "User menu"}
        className={cn(
          "inline-flex items-center justify-center rounded-[var(--radius-full)]",
          "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]",
          "font-medium shrink-0 cursor-pointer hover:opacity-90 transition-opacity",
          sizeMap[size],
          className
        )}
      >
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={userName || "User"}
            width={32}
            height={32}
            className="h-full w-full rounded-[var(--radius-full)] object-cover"
          />
        ) : initials ? (
          <span>{initials}</span>
        ) : (
          <User className="h-4 w-4" />
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-48 rounded-[var(--radius-lg)] border border-border bg-card shadow-lg z-50 overflow-hidden">
          {/* User info */}
          <div className="px-3 py-2.5 border-b border-border">
            <p className="text-sm font-medium text-[hsl(var(--foreground))] truncate">
              {userName || "User"}
            </p>
          </div>

          {/* Menu items */}
          <div className="py-1">
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--background-muted))] transition-colors"
            >
              <Settings className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
              Profile & Settings
            </Link>
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
  );
}
