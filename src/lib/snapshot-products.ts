import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The company's products, for inclusion in a plan snapshot.
 *
 * WHY SNAPSHOTS NEED THEM. Every initiative has a NOT NULL product_id, so
 * restoring a snapshot means attaching each initiative to a product. Snapshots
 * used to store initiatives, tasks and targets but never the products, and
 * restore depended on the products still existing. Delete the products and
 * then restore: every initiative was skipped for having no product, and the
 * screen still said "Plan restored — 0 initiative(s) added".
 *
 * Never throws. A snapshot without products is still worth writing — restore
 * has a fallback for that case — so a failed read must not abort the snapshot.
 */
export async function snapshotProducts(
  db: SupabaseClient,
  companyId: string
): Promise<Record<string, unknown>[]> {
  try {
    const { data, error } = await db
      .from("products")
      .select("*")
      .eq("company_id", companyId);

    if (error) {
      console.error("[snapshot-products] Could not read products:", error.message);
      return [];
    }
    return (data ?? []) as Record<string, unknown>[];
  } catch (err) {
    console.error(
      "[snapshot-products] Could not read products:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
