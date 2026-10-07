"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { IntakeShell } from "@/components/intake/intake-shell";
import { useIntakeDraft } from "@/components/intake/use-intake-draft";
import { ScreenStart } from "@/components/intake/screens/screen-start";
import { ScreenBusiness } from "@/components/intake/screens/screen-business";
import { ScreenTeam } from "@/components/intake/screens/screen-team";
import { ScreenProducts } from "@/components/intake/screens/screen-products";
import { ScreenGoal } from "@/components/intake/screens/screen-goal";
import { FormError } from "@/components/intake/fields/field";
import type { ScreenId } from "@/lib/intake/flow";
import {
  validateScreen,
  type ValidationResult,
} from "@/lib/intake/validation";
import { MIN_PRODUCTS } from "@/lib/intake/schema";
import { pathSelected, trackIntakeEvent } from "@/lib/intake/events";
import type { PlanPath } from "@/lib/intake/flow";

/**
 * The intake, one screen per route.
 *
 * WHY A ROUTE PER SCREEN rather than one page holding an index: save-and-resume
 * needs a URL to return to (REQ-2.4). An index in state cannot be linked to, a
 * refresh would lose the position, and the analytics `screen` property would
 * have to be derived rather than read.
 *
 * Validation runs ON NEXT, not on change. Marking a field invalid before the
 * user has finished typing it is noise, and the shell focuses the first error
 * when Next is blocked so nothing is hidden below the fold.
 */
export function IntakePage({ screen }: { screen: ScreenId }) {
  const router = useRouter();
  const draft = useIntakeDraft();
  const [result, setResult] = React.useState<ValidationResult | null>(null);

  const { state, path } = draft;

  /**
   * Resume where the user left off.
   *
   * Only redirects when they land on screen 0 with a saved position — arriving
   * at a specific screen is a deliberate act (Back, a bookmark, a link) and
   * overriding it would make the flow impossible to navigate backwards.
   */
  React.useEffect(() => {
    if (draft.loading) return;
    if (screen !== "start") return;
    if (!draft.resumeScreen || draft.resumeScreen === "start") return;
    router.replace(`/intake/${draft.resumeScreen}`);
  }, [draft.loading, draft.resumeScreen, screen, router]);

  /**
   * Screen 3 needs one product card to exist before it can be filled in.
   *
   * Seeded here rather than in the initial draft state so a user who never
   * reaches the screen does not get an empty product row saved against them.
   */
  React.useEffect(() => {
    if (draft.loading) return;
    if (screen === "products" && state.products.length < MIN_PRODUCTS) {
      draft.setProducts([{}]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.loading, screen, state.products.length]);

  const validate = React.useCallback(() => {
    const next = validateScreen({
      screen,
      answers: state.answers,
      products: state.products,
      initiatives: state.initiatives,
    });
    setResult(next);
    return next.valid;
  }, [screen, state]);

  // Clearing on screen change stops a previous screen's errors from appearing
  // against the new one's fields.
  React.useEffect(() => {
    setResult(null);
  }, [screen]);

  const errors = result?.errors ?? {};
  const rowErrors = result?.rowErrors ?? {};
  const formError = result?.formError ?? null;

  if (draft.loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2
          className="h-6 w-6 animate-spin text-[hsl(var(--foreground-muted))]"
          aria-label="Loading your answers"
        />
      </div>
    );
  }

  if (draft.loadError) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <FormError message={draft.loadError} />
      </div>
    );
  }

  return (
    <IntakeShell
      screen={screen}
      path={path}
      onValidate={validate}
      onSave={draft.save}
      saving={draft.saving}
      saveError={draft.saveError}
      hideBack={screen === "start"}
      onComplete={() => router.push("/intake/recommendations")}
    >
      {screen === "start" && (
        <ScreenStart
          value={path}
          onChange={(value: PlanPath) => {
            draft.setAnswer("intake_path", value);
            void trackIntakeEvent(pathSelected(value));
          }}
          errors={errors}
        />
      )}

      {screen === "business" && (
        <ScreenBusiness
          answers={state.answers}
          setAnswer={draft.setAnswer}
          errors={errors}
          path={path}
        />
      )}

      {screen === "team" && (
        <ScreenTeam
          answers={state.answers}
          setAnswer={draft.setAnswer}
          errors={errors}
        />
      )}

      {screen === "products" && (
        <ScreenProducts
          answers={state.answers}
          setAnswer={draft.setAnswer}
          products={state.products}
          setProducts={draft.setProducts}
          errors={errors}
          rowErrors={rowErrors}
          formError={formError}
        />
      )}

      {screen === "goal" && (
        <ScreenGoal
          answers={state.answers}
          setAnswer={draft.setAnswer}
          errors={errors}
        />
      )}

      {/*
        Screens 5 to 9 are not built yet. Stated plainly rather than rendering
        an empty shell, which would look like a screen with no questions.
      */}
      {NOT_YET_BUILT.includes(screen) && (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-border px-4 py-8 text-center text-sm text-[hsl(var(--foreground-muted))]">
          This screen is still being built.
        </p>
      )}
    </IntakeShell>
  );
}

const NOT_YET_BUILT: ScreenId[] = [
  "initiatives",
  "wins",
  "customer",
  "audience",
  "obstacles",
];
