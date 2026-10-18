import {
  resolveInitiativeTypeId,
  type InitiativeTypeStore,
} from "@/lib/workbook/initiative-type";
import { defaultLibraryMetricSet, type MetricsSource } from "@/lib/metrics/library-metric-set";
import type { InitiativeMetricSet } from "@/lib/metrics/metric-set";

/**
 * How an accepted `new_initiative` plan suggestion becomes an initiative's
 * type, library key and metric set.
 *
 * The route used to load every `initiative_types` row and take the channel
 * match OR, failing that, the first row in the table — so a suggestion for a
 * key with no type yet was attached to an arbitrary unrelated type. It now
 * uses the shared rule (src/lib/workbook/initiative-type.ts): the oldest row
 * with the channel, active or not, else one created once from the library.
 */

/** The library fields used: type source and metrics. LibraryEntry satisfies it. */
export interface SuggestionLibraryEntry extends MetricsSource {
  name: string;
  oneLiner: string | null;
  difficulty: number | null;
}

/** The suggestion's library key; `channel` only for suggestions made before the library. */
export function suggestionChannel(proposed: Readonly<Record<string, unknown>>): string {
  for (const v of [proposed.libraryKey, proposed.channel]) {
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return "custom";
}

export interface SuggestionInitiativeMapping {
  typeId: string | null;
  /** Null unless the channel is a library key. */
  libraryKey: string | null;
  metricSet: InitiativeMetricSet | null;
}

export async function resolveSuggestionInitiative(
  store: InitiativeTypeStore,
  channel: string,
  entry: SuggestionLibraryEntry | null | undefined
): Promise<SuggestionInitiativeMapping> {
  const typeId = await resolveInitiativeTypeId(
    store,
    channel,
    entry ? { name: entry.name, oneLiner: entry.oneLiner, difficulty: entry.difficulty } : null
  );
  return {
    typeId,
    libraryKey: entry ? channel : null,
    metricSet: entry ? defaultLibraryMetricSet(channel, entry) : null,
  };
}
