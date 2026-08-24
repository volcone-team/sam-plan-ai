"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";

/**
 * Renders "Back to Home" (/) for guests or "Back to Dashboard" (/year-at-a-glance)
 * for logged-in users.
 */
export function OnboardingBackLink() {
  const [href, setHref] = useState("/");
  const [label, setLabel] = useState("Back to Home");

  useEffect(() => {
    async function check() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setHref("/year-at-a-glance");
        setLabel("Back to Dashboard");
      }
    }
    check();
  }, []);

  return (
    <Link
      href={href}
      className="flex items-center gap-2 text-sm text-[hsl(var(--foreground-muted))] hover:text-foreground transition-colors"
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </Link>
  );
}
