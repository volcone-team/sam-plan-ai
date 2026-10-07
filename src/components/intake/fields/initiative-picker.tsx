"use client";

import * as React from "react";
import { Search, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  groupInitiatives,
  labelFor,
  platformOf,
  type LibraryInitiative,
} from "@/lib/intake/library";
import { SOMETHING_ELSE_KEY } from "@/lib/intake/schema";

/**
 * Searchable, grouped initiative picker for screens 5 and 6 (REQ-8.1 to
 * REQ-8.5, REQ-9.1).
 *
 * Searchable rather than a plain dropdown because the library is 22 entries
 * under seven headings with names like "OPS - In Person (Other People's
 * Stages)" — scanning that in a native select is miserable, and the user
 * usually arrives knowing the word they want.
 *
 * All the filtering, grouping and labelling is delegated to `lib/intake/library.ts`
 * so it is tested independently of the markup. This component is presentation.
 */

export interface InitiativePickerProps {
  id?: string;
  initiatives: readonly LibraryInitiative[];
  /** Single-select: the chosen key, or null. */
  value: string | null;
  onChange: (key: string | null) => void;
  /** Unlocks Ticket Map items (REQ-8.3). */
  hasEventProduct?: boolean;
  /** Keys to leave out — e.g. already answered on screen 5 (REQ-9.2). */
  exclude?: readonly string[];
  /** Offers "Something else", which sets `needs_review` (REQ-8.1). */
  allowSomethingElse?: boolean;
  error?: boolean;
  placeholder?: string;
}

export function InitiativePicker({
  id,
  initiatives,
  value,
  onChange,
  hasEventProduct,
  exclude,
  allowSomethingElse = true,
  error,
  placeholder = "Search initiatives…",
}: InitiativePickerProps) {
  const [search, setSearch] = React.useState("");

  const groups = React.useMemo(
    () => groupInitiatives(initiatives, { search, hasEventProduct, exclude }),
    [initiatives, search, hasEventProduct, exclude]
  );

  const selected = React.useMemo(
    () => initiatives.find((i) => i.key === value) ?? null,
    [initiatives, value]
  );

  const somethingElseChosen = value === SOMETHING_ELSE_KEY;
  const nothingFound = groups.length === 0 && search.trim() !== "";

  /**
   * Once chosen, the list collapses to the single answer with a Change control.
   * A long scrolling list left open under a made decision reads as unfinished,
   * and on screen 5 this sits inside a repeater where several are stacked.
   */
  if (selected || somethingElseChosen) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.06)] px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {selected ? labelFor(selected, initiatives) : "Something else"}
          </p>
          {selected?.oneLiner && (
            <p className="mt-0.5 truncate text-xs text-[hsl(var(--foreground-muted))]">
              {selected.oneLiner}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setSearch("");
          }}
          className="shrink-0 rounded-[var(--radius-md)] px-2 py-1 text-xs font-medium text-[hsl(var(--foreground-muted))] transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--foreground-muted))]"
          aria-hidden="true"
        />
        <Input
          id={id}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder}
          error={error}
          className="pl-9"
          // Announced as a filter rather than a plain text box, so the result
          // count below makes sense to a screen reader.
          role="combobox"
          aria-expanded
          aria-controls={id ? `${id}-results` : undefined}
        />
        {search !== "" && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[hsl(var(--foreground-muted))] transition-colors hover:bg-[hsl(var(--background-muted))] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      <div
        id={id ? `${id}-results` : undefined}
        className={cn(
          "max-h-80 overflow-y-auto rounded-[var(--radius-md)] border",
          error ? "border-[hsl(var(--invalid-border))]" : "border-input"
        )}
      >
        {nothingFound ? (
          <p className="px-3 py-6 text-center text-sm text-[hsl(var(--foreground-muted))]">
            Nothing matches &ldquo;{search}&rdquo;.
            {allowSomethingElse && " Pick \u201cSomething else\u201d below."}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.group}>
              {/*
                Sticky so the heading stays visible while scrolling a long
                group — otherwise the user loses track of what they are inside.
              */}
              <p className="sticky top-0 border-b border-border bg-[hsl(var(--background-muted))] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--foreground-muted))]">
                {group.group}
              </p>
              <ul>
                {group.initiatives.map((initiative) => (
                  <li key={initiative.key}>
                    <button
                      type="button"
                      onClick={() => onChange(initiative.key)}
                      className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-[hsl(var(--background-muted))] focus-visible:bg-[hsl(var(--background-muted))] focus-visible:outline-none"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">
                          {labelFor(initiative, initiatives)}
                        </span>
                        {initiative.oneLiner && (
                          <span className="mt-0.5 block text-xs text-[hsl(var(--foreground-muted))]">
                            {initiative.oneLiner}
                          </span>
                        )}
                      </span>
                      <PlatformBadge initiative={initiative} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}

        {/*
          REQ-8.1 — the escape hatch. Kept at the very bottom so it is the last
          resort rather than a shortcut past the library, and a customer naming
          something the library lacks is a signal worth capturing.
        */}
        {allowSomethingElse && (
          <button
            type="button"
            onClick={() => onChange(SOMETHING_ELSE_KEY)}
            className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-sm text-[hsl(var(--foreground-muted))] transition-colors hover:bg-[hsl(var(--background-muted))] hover:text-foreground focus-visible:bg-[hsl(var(--background-muted))] focus-visible:outline-none"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Something else
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Platform shown as a badge rather than folded into the name.
 *
 * REQ-8.4 only wants the suffix where a name is genuinely ambiguous, but the
 * distinction is useful on every row — so it is surfaced here, where it informs
 * without asserting something odd like "Courses & Memberships (on someone
 * else's platform)".
 */
function PlatformBadge({ initiative }: { initiative: LibraryInitiative }) {
  const platform = platformOf(initiative);
  if (!platform) return null;

  return (
    <span
      className="mt-0.5 shrink-0 rounded-full bg-[hsl(var(--background-muted))] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--foreground-muted))]"
      title={
        platform === "own"
          ? "Runs on your own platform"
          : "Runs on someone else's platform"
      }
    >
      {platform === "own" ? "Yours" : "Theirs"}
    </span>
  );
}
