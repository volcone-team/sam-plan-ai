"use client";

import { useState } from "react";
import { AlertTriangle, Sparkles, RefreshCw, X } from "lucide-react";

interface RegenerateModalProps {
  open: boolean;
  onClose: () => void;
  /** User chose "Start from Scratch" and confirmed the hard warning */
  onStartFromScratch: () => void;
  /** User chose "Enhance Current Plan" */
  onEnhance: () => void;
}

type Step = "choice" | "scratch-confirm";

/**
 * Two-step plan regeneration modal.
 *
 * Step 1 (choice): warns, then offers two paths —
 *   - Start from Scratch (destructive to upcoming initiatives)
 *   - Enhance Current Plan (AI suggestions, nothing deleted)
 *
 * Step 2 (scratch-confirm): only shown if the user picks Start from Scratch.
 *   Hard warning that upcoming (not-yet-started) initiatives will be deleted,
 *   while completed and in-progress work is kept.
 */
export function RegenerateModal({
  open,
  onClose,
  onStartFromScratch,
  onEnhance,
}: RegenerateModalProps) {
  const [step, setStep] = useState<Step>("choice");

  if (!open) return null;

  const close = () => {
    console.log("[RegenerateModal] Closed");
    setStep("choice"); // reset for next open
    onClose();
  };

  const chooseScratch = () => {
    console.log("[RegenerateModal] Chose: Start from Scratch → showing hard confirm");
    setStep("scratch-confirm");
  };

  const chooseEnhance = () => {
    console.log("[RegenerateModal] Chose: Enhance Current Plan");
    setStep("choice");
    onEnhance();
  };

  const confirmScratch = () => {
    console.log("[RegenerateModal] Confirmed: Start from Scratch");
    setStep("choice");
    onStartFromScratch();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-[var(--radius-lg)] border border-border bg-card p-6 shadow-xl">
        {/* Close button */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <h3 className="text-lg font-semibold">
              {step === "choice" ? "Regenerate Your Plan?" : "Start from Scratch?"}
            </h3>
          </div>
          <button
            onClick={close}
            className="rounded-md p-1 text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--background-muted))]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* STEP 1: Choice */}
        {step === "choice" && (
          <>
            <p className="mt-2 text-sm text-[hsl(var(--foreground-muted))]">
              How would you like to regenerate? Your past and in-progress work is always kept.
            </p>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Start from scratch */}
              <button
                onClick={chooseScratch}
                className="flex flex-col items-start gap-2 rounded-[var(--radius-lg)] border border-border p-4 text-left transition-colors hover:border-amber-400 hover:bg-amber-50/40 dark:hover:bg-amber-950/10"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                  <RefreshCw className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
                <span className="text-sm font-semibold">Start from Scratch</span>
                <span className="text-xs text-[hsl(var(--foreground-muted))]">
                  Build a fresh plan. Upcoming initiatives you haven&apos;t started yet will be replaced.
                </span>
              </button>

              {/* Enhance */}
              <button
                onClick={chooseEnhance}
                className="flex flex-col items-start gap-2 rounded-[var(--radius-lg)] border border-border p-4 text-left transition-colors hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.05)]"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--primary)/0.1)]">
                  <Sparkles className="h-4 w-4 text-[hsl(var(--primary))]" />
                </div>
                <span className="text-sm font-semibold">Enhance Current Plan</span>
                <span className="text-xs text-[hsl(var(--foreground-muted))]">
                  Get AI recommendations to improve your current plan. You approve each change.
                </span>
              </button>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={close}
                className="rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--background-muted))]"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {/* STEP 2: Hard confirm for start from scratch */}
        {step === "scratch-confirm" && (
          <>
            <div className="mt-4 rounded-[var(--radius-md)] border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                This will delete all your upcoming initiatives that haven&apos;t started yet.
              </p>
              <ul className="mt-2 space-y-1 text-xs text-amber-800 dark:text-amber-300">
                <li>• Completed initiatives are kept</li>
                <li>• In-progress initiatives are kept</li>
                <li>• Only not-yet-started, future initiatives are removed</li>
                <li>• Your current plan is saved to history first — nothing is lost</li>
              </ul>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                onClick={() => setStep("choice")}
                className="rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--background-muted))]"
              >
                Back
              </button>
              <button
                onClick={confirmScratch}
                className="rounded-[var(--radius-md)] bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
              >
                Yes, Start from Scratch
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
