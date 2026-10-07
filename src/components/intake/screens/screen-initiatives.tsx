"use client";

import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InitiativeDraft, ProductDraft } from "@/lib/intake/draft";
import type { FieldErrors } from "@/lib/intake/validation";
import type { LibraryInitiative } from "@/lib/intake/library";
import { FormError } from "../fields/field";
import { InitiativeCard, hasEventProduct } from "../fields/initiative-card";

/**
 * Screen 5 — what you're already planning (Paths A and B only).
 *
 * Path C never reaches this screen: `flow.ts` omits it from the sequence
 * entirely rather than hiding it, so there is no "skip" branch here to get
 * wrong.
 *
 * Only `source: 'planned'` rows belong to this screen. Screen 6 writes 'worked'
 * and 'failed' rows into the same array, so both filter on source — otherwise
 * each screen would show the other's answers.
 */
export function ScreenInitiatives({
  initiatives,
  setInitiatives,
  products,
  library,
  libraryLoading,
  libraryError,
  rowErrors,
  formError,
}: {
  initiatives: InitiativeDraft[];
  setInitiatives: (initiatives: InitiativeDraft[]) => void;
  products: readonly ProductDraft[];
  library: readonly LibraryInitiative[];
  libraryLoading: boolean;
  libraryError: string | null;
  rowErrors: Record<number, FieldErrors>;
  formError: string | null;
}) {
  // Indices into the full array, so an edit writes back to the right row
  // without disturbing screen 6's entries.
  const planned = initiatives
    .map((initiative, index) => ({ initiative, index }))
    .filter(({ initiative }) => (initiative.source ?? "planned") === "planned");

  const update = (index: number, patch: Partial<InitiativeDraft>) => {
    setInitiatives(
      initiatives.map((item, i) => (i === index ? { ...item, ...patch } : item))
    );
  };

  if (libraryLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2
          className="h-5 w-5 animate-spin text-[hsl(var(--foreground-muted))]"
          aria-label="Loading initiatives"
        />
      </div>
    );
  }

  if (libraryError) return <FormError message={libraryError} />;

  return (
    <>
      <div className="space-y-4">
        {planned.map(({ initiative, index }, position) => (
          <InitiativeCard
            key={index}
            index={position}
            initiative={initiative}
            products={products}
            library={library}
            hasEventProduct={hasEventProduct(products)}
            errors={rowErrors[position] ?? {}}
            onChange={(patch) => update(index, patch)}
            onRemove={() =>
              setInitiatives(initiatives.filter((_, i) => i !== index))
            }
            canRemove={planned.length > 1}
          />
        ))}

        <FormError message={formError} />

        <Button
          type="button"
          variant="outline"
          onClick={() => setInitiatives([...initiatives, { source: "planned" }])}
          className="w-full"
        >
          <Plus className="h-4 w-4" />
          Add another initiative
        </Button>
      </div>
    </>
  );
}
