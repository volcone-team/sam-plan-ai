/**
 * Telling apart initiatives that share a name.
 *
 * The Oct 2026 library has variants with identical names: two "Hybrid Events"
 * filed under different categories, and OWN/OPS pairs of the same initiative.
 * Shown side by side they look like a duplicated row, so wherever a list holds
 * more than one item with the same name, each gets a short subtitle that says
 * which one it is.
 *
 * The rule, first match wins:
 *   1. Own/Ops, when it differs from every same-name sibling
 *      ("Your own stage" / "Other people's stages", anything else as written);
 *   2. otherwise the category, when it differs from every same-name sibling;
 *   3. otherwise both together, when the pair differs;
 *   4. otherwise nothing — there is no field that would help.
 *
 * A name that is unique in its list gets no subtitle at all.
 *
 * Pure: no I/O.
 */

/** The fields read. Library items, recommendations and browse rows all satisfy this. */
export interface NamedItem {
  key: string;
  name: string;
  category?: string | null;
  ownOrOps?: string | null;
}

export type DistinguishingBasis = "ownOrOps" | "category" | "both";

export interface DistinguishingDetail {
  /** The subtitle to show. */
  label: string;
  /** Which field(s) the label came from. */
  basis: DistinguishingBasis;
}

function norm(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Own/Ops in words. OWN and OPS are translated; any other non-blank value
 * ("OWN & OPS") is returned as written. Null when blank.
 */
export function ownOrOpsLabel(value: string | null | undefined): string | null {
  const raw = (value ?? "").replace(/\s+/g, " ").trim();
  if (raw === "") return null;
  const upper = raw.toUpperCase();
  if (upper === "OWN") return "Your own stage";
  if (upper === "OPS") return "Other people's stages";
  return raw;
}

function categoryLabel(value: string | null | undefined): string | null {
  const raw = (value ?? "").replace(/\s+/g, " ").trim();
  return raw === "" ? null : raw;
}

/**
 * What distinguishes `item` from the other items in `siblings` that share its
 * name, or null when its name is unique (or nothing distinguishes it).
 *
 * `siblings` may include `item` itself; it is skipped by key.
 */
export function distinguishingDetail(
  item: NamedItem,
  siblings: readonly NamedItem[]
): DistinguishingDetail | null {
  const name = norm(item.name);
  const twins = siblings.filter((s) => s !== item && s.key !== item.key && norm(s.name) === name);
  if (twins.length === 0) return null;

  const own = ownOrOpsLabel(item.ownOrOps);
  const category = categoryLabel(item.category);

  if (own && twins.every((t) => norm(t.ownOrOps) !== norm(item.ownOrOps))) {
    return { label: own, basis: "ownOrOps" };
  }
  if (category && twins.every((t) => norm(t.category) !== norm(item.category))) {
    return { label: category, basis: "category" };
  }
  if (
    own &&
    category &&
    twins.every(
      (t) => norm(t.ownOrOps) !== norm(item.ownOrOps) || norm(t.category) !== norm(item.category)
    )
  ) {
    return { label: `${own} · ${category}`, basis: "both" };
  }
  return null;
}

/** The subtitle alone. See distinguishingDetail. */
export function distinguishingLabel(item: NamedItem, siblings: readonly NamedItem[]): string | null {
  return distinguishingDetail(item, siblings)?.label ?? null;
}

/**
 * The subtitle for a list that ALREADY shows Own/Ops on every row (as a
 * platform badge), so repeating it would say the same thing twice.
 *
 * Returns the category where that is what tells the twins apart (alone, or
 * together with the Own/Ops the badge already shows), and null where Own/Ops
 * alone does the job. A row with no badge (Own/Ops other than plain OWN or
 * OPS) gets the full label.
 */
export function distinguishingLabelBesideOwnOrOps(
  item: NamedItem,
  siblings: readonly NamedItem[]
): string | null {
  const detail = distinguishingDetail(item, siblings);
  if (!detail) return null;
  // The badge only exists for plain OWN / OPS; anything else ("OWN & OPS")
  // has no badge, so the label must carry it.
  const badged = ["OWN", "OPS"].includes((item.ownOrOps ?? "").trim().toUpperCase());
  if (detail.basis === "ownOrOps") return badged ? null : detail.label;
  if (!badged) return detail.label;
  return detail.basis === "both" ? categoryLabel(item.category) : detail.label;
}
