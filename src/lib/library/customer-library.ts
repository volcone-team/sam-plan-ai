import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLibrary } from "@/lib/workbook/read";
import { toCustomerLibraryItem, type CustomerLibraryItem } from "@/lib/library/picker";

/**
 * Every ACTIVE library initiative, narrowed to what a customer picker needs.
 *
 * Active means what loadLibrary means: the admin toggles in
 * `initiative_settings` apply, and a key with no settings row is active. No
 * eligibility rules and no category exclusions — the owner's requirement is
 * that every active initiative can be picked.
 */
export async function loadCustomerLibrary(db: SupabaseClient): Promise<CustomerLibraryItem[]> {
  return (await loadLibrary(db)).map(toCustomerLibraryItem);
}
