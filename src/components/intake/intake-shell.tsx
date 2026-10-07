"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/brand-logo";
import {
  HELPER_LINE,
  finalButtonLabel,
  isFinalScreen,
  nextScreen,
  prevScreen,
  showsHelperLine,
  type PlanPath,
  type ScreenId,
} from "@/lib/intake/flow";
import { SCREEN_COPY, subtitleFor } from "@/lib/intake/schema";
import {
  screenCompleted,
  screenViewed,
  trackIntakeEvent,
} from "@/lib/intake/events";
import { ScreenHeader, FormError } from "./fields/field";
import { IntakeProgress } from "./intake-progress";

/**
 * The frame every intake screen renders inside: progress, header, navigation,
 * autosave and event firing.
 *
 * Screens own their FIELDS and nothing else. Navigation, saving and analytics
 * live here so ten screens cannot each get them subtly different — and so the
 * path rules stay in `flow.ts`, which is tested, rather than being re-derived
 * in markup.
 *
 * The save happens BEFORE navigating, and a failure blocks the move. Advancing
 * on a failed save is the one behaviour that silently loses answers: the user
 * sees the next screen, assumes the last one is stored, and finds it empty when
 * they return.
 */

export interface IntakeShellProps {
  screen: ScreenId;
  path: PlanPath | null;

  /** Validate the current screen. Returning false blocks Next. */
  onValidate: () => boolean;
  /** Persist the draft, recording the resume position. */
  onSave: (resumeScreen: ScreenId) => Promise<boolean>;
  saving?: boolean;
  saveError?: string | null;

  /**
   * The final screen's action. Called instead of navigating, so the shell does
   * not need to know that it leads to the recommendations screen.
   */
  onComplete?: () => void | Promise<void>;

  /** Hides Back on the first screen, which has nowhere to go. */
  hideBack?: boolean;
  /** Blocks Next while something the screen owns is unresolved. */
  nextDisabled?: boolean;

  children: React.ReactNode;
}

export function IntakeShell({
  screen,
  path,
  onValidate,
  onSave,
  saving = false,
  saveError = null,
  onComplete,
  hideBack,
  nextDisabled,
  children,
}: IntakeShellProps) {
  const router = useRouter();
  const [navigating, setNavigating] = React.useState(false);

  const copy = SCREEN_COPY[screen];
  const subtitle = subtitleFor(screen, path);
  const final = isFinalScreen(path, screen);
  const back = prevScreen(path, screen);

  /**
   * When this screen was first shown, for the dwell time on
   * `intake_screen_completed`.
   *
   * A ref rather than state: it is read once on Next and must not trigger a
   * re-render, which would reset the very timer it measures.
   */
  const shownAt = React.useRef<number>(Date.now());

  React.useEffect(() => {
    shownAt.current = Date.now();
    void trackIntakeEvent(screenViewed(screen, path));
    // `path` is deliberately omitted: answering screen 0 changes the path and
    // would otherwise re-fire a view for a screen the user never left.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  /**
   * Save when the tab is hidden.
   *
   * The common abandonment is wandering off mid-screen, not closing the tab.
   * This is best-effort — nothing is reported and nothing blocks — so a failure
   * here is invisible, which is correct: the user has not asked for anything.
   */
  React.useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") void onSave(screen);
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [onSave, screen]);

  const goTo = (target: ScreenId) => {
    router.push(`/intake/${target}`);
  };

  const handleNext = async () => {
    if (!onValidate()) {
      // Scrolled into view because on a long screen the failing field can be
      // well below the fold, and a Next that appears to do nothing reads as a
      // broken button.
      focusFirstError();
      return;
    }

    setNavigating(true);
    try {
      const saved = await onSave(screen);
      if (!saved) return;

      void trackIntakeEvent(
        screenCompleted(screen, path, (Date.now() - shownAt.current) / 1000)
      );

      if (final) {
        await onComplete?.();
        return;
      }

      const target = nextScreen(path, screen);
      if (target) goTo(target);
    } finally {
      setNavigating(false);
    }
  };

  /**
   * Back never validates and never saves (REQ-2.4: Back must not clear
   * answers). Answers are already in state, and the next forward move persists
   * them — so an incomplete screen can be left and returned to.
   */
  const handleBack = () => {
    if (back) goTo(back);
  };

  const busy = saving || navigating;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="shrink-0 border-b border-border">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-center px-4 sm:px-6">
          <BrandLogo />
        </div>
      </header>

      <IntakeProgress path={path} screen={screen} />

      <main className="flex-1 px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-8">
          <ScreenHeader
            title={copy.title}
            subtitle={subtitle || undefined}
            // Screens 0, 5 and 9 omit it; flow.ts owns that rule.
            helperLine={showsHelperLine(screen) ? HELPER_LINE : undefined}
          />

          <div className="space-y-6">{children}</div>

          <FormError message={saveError} />

          <div className="flex items-center justify-between gap-3 border-t border-border pt-6">
            {hideBack || !back ? (
              <span />
            ) : (
              <Button
                type="button"
                variant="ghost"
                onClick={handleBack}
                disabled={busy}
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            )}

            <Button
              type="button"
              onClick={handleNext}
              disabled={busy || nextDisabled}
              size="lg"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {final ? finalButtonLabel(path) : "Next"}
              {!final && !busy && <ArrowRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * Move focus to the first invalid control.
 *
 * Focus rather than just scroll, so the error is announced to a screen reader
 * as well as made visible — `aria-invalid` is set by `Field`, which is what
 * this selector keys off.
 */
function focusFirstError() {
  if (typeof document === "undefined") return;
  const target = document.querySelector<HTMLElement>(
    '[aria-invalid="true"], [role="alert"]'
  );
  if (!target) return;

  target.scrollIntoView({ behavior: "smooth", block: "center" });
  if (typeof target.focus === "function") {
    target.focus({ preventScroll: true });
  }
}
