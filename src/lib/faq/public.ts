/**
 * FAQ — server-side loading of the public FAQ.
 *
 * Reads both FAQ tables with a SERVICE-ROLE client and hands the rows to
 * `buildPublicFaq` (./faq), the only builder of the customer view. Drafts and
 * unpublished categories are filtered in SQL as well, so they never even
 * reach this process.
 *
 * Server-only. Kept free of Next so it can be tested with a fake client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTableError } from "@/lib/db-errors";
import { buildPublicFaq, faqCategoryFromRow, faqItemFromRow } from "./faq";
import { FAQ_CATEGORY_SELECT, FAQ_ITEM_SELECT } from "./admin-repo";
import type { FaqCategoryRow, FaqItemRow, FaqPublicResponse } from "@/types/faq.types";

/** Thrown when migration 039 has not been applied to this database. */
export class FaqMigrationMissingError extends Error {
  constructor(detail: string) {
    super(`FAQ tables are missing (migration 039 not applied): ${detail}`);
    this.name = "FaqMigrationMissingError";
  }
}

interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
}

function check(table: string, error: PostgrestLikeError | null): void {
  if (!error) return;
  if (isMissingTableError(error)) {
    throw new FaqMigrationMissingError(`${table}: ${error.message ?? error.code ?? "missing"}`);
  }
  throw new Error(`[faq] ${table} query failed: ${error.message ?? error.code ?? "unknown error"}`);
}

/**
 * The published FAQ, the same for every signed-in user.
 *
 * @throws FaqMigrationMissingError when an FAQ table is missing.
 * @throws Error on any other query failure.
 */
export async function loadPublicFaq(db: SupabaseClient): Promise<FaqPublicResponse> {
  const [categoriesRes, itemsRes] = await Promise.all([
    db.from("faq_categories").select(FAQ_CATEGORY_SELECT).eq("is_published", true),
    db.from("faq_items").select(FAQ_ITEM_SELECT).eq("status", "published"),
  ]);
  check("faq_categories", categoriesRes.error);
  check("faq_items", itemsRes.error);

  const categories = ((categoriesRes.data ?? []) as unknown as FaqCategoryRow[]).map(faqCategoryFromRow);
  const items = ((itemsRes.data ?? []) as unknown as FaqItemRow[]).map(faqItemFromRow);
  return { categories: buildPublicFaq(categories, items) };
}
