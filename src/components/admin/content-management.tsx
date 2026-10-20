"use client";

import { useState } from "react";
import { GraduationCap, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { UniversityManagement } from "./university-management";
import { FaqManagement } from "./faq-management";

/* ------------------------------------------------------------------
   Types
   ------------------------------------------------------------------ */

type TabKey = "university" | "faq";

interface TabConfig {
  key: TabKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

/* ------------------------------------------------------------------
   Constants
   ------------------------------------------------------------------ */

/*
 * There used to be a third tab, "Emails", holding three sample templates in
 * localStorage. It was a mock: nothing sent from it, nothing read it, and
 * edits lived in one admin's browser. The real transactional templates are
 * written in code — src/lib/mailgun.ts, with the invite in
 * src/lib/team-invite.ts — so a working editor needs them moved into the
 * database first. Removed rather than hidden so it cannot be mistaken for one.
 */
const TABS: TabConfig[] = [
  { key: "university", label: "University", icon: GraduationCap },
  { key: "faq", label: "FAQ", icon: HelpCircle },
];

/* ------------------------------------------------------------------
   Main Component
   ------------------------------------------------------------------ */

export function ContentManagement() {
  const [activeTab, setActiveTab] = useState<TabKey>("university");

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-[hsl(var(--primary))] text-white"
                  : "text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--background))]"
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "university" ? <UniversityManagement /> : <FaqManagement />}
    </div>
  );
}
