/**
 * An initiative's actual spend, and the Reports > ROI computation built on it.
 *
 * Decision D2: an initiative's actual spend is the sum of its recorded
 * expenses. The hand-typed `initiatives.actual_spend` is never read here.
 *
 * Spend is summed in integer cents (0.1 + 0.2 must be 0.3), so ROI Total Spend
 * matches the Expenses report to the cent. Revenue, net, ROI and both sort
 * orders are copied from the original inline logic in `roi-report.tsx` so the
 * report's columns and ordering are unchanged (requirements 3.5–3.7).
 */

/** Structural, so the real `Expense` type (initiativeId, amount) fits directly. */
export interface SpendExpenseRow {
  initiativeId: string | null | undefined;
  amount: number | string;
}

/** Only the fields the ROI report reads; the real `Initiative` type fits. */
export interface RoiInitiativeInput {
  id: string;
  name: string;
  status: string;
  initiativeTypeId: string;
}

export interface RoiRow {
  id: string;
  name: string;
  typeName: string;
  revenue: number;
  spend: number;
  net: number;
  roi: number | null;
  status: string;
}

export interface RoiTypeRow {
  /** Grouping key. Today's report groups by type name, so this is the name. */
  typeId: string;
  typeName: string;
  totalRevenue: number;
  totalSpend: number;
  roi: number | null;
}

export interface RoiReport {
  rows: RoiRow[];
  typeRows: RoiTypeRow[];
  totalRevenue: number;
  totalSpend: number;
  /** Expenses not attached to an initiative in `rows` (≥ 0, cents). */
  unattributedSpend: number;
}

export interface BuildRoiReportInput<I extends RoiInitiativeInput> {
  initiatives: readonly I[];
  revenueById: ReadonlyMap<string, number>;
  spendById: ReadonlyMap<string, number>;
  typeNameById: ReadonlyMap<string, string>;
  /** Reports > Expenses total for the same company (same RLS scope). */
  companyExpenseTotal: number;
}

/** Amount in integer cents; non-finite or unparsable counts as 0. */
function toCents(value: number | string | null | undefined): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Σ expense amount per initiative id, in cents then dollars. Rows with no initiative are skipped. */
export function sumExpensesByInitiative(
  expenses: readonly SpendExpenseRow[]
): Map<string, number> {
  const cents = new Map<string, number>();
  for (const e of expenses) {
    if (!e.initiativeId) continue;
    cents.set(e.initiativeId, (cents.get(e.initiativeId) ?? 0) + toCents(e.amount));
  }
  const dollars = new Map<string, number>();
  for (const [id, c] of cents) dollars.set(id, c / 100);
  return dollars;
}

/** Today's comparator: ROI descending, nulls last, ties keep input order. */
function byRoiDesc(a: { roi: number | null }, b: { roi: number | null }): number {
  if (a.roi === null && b.roi === null) return 0;
  if (a.roi === null) return 1;
  if (b.roi === null) return -1;
  return b.roi - a.roi;
}

export function buildRoiReport<I extends RoiInitiativeInput>(
  input: BuildRoiReportInput<I>
): RoiReport {
  const { initiatives, revenueById, spendById, typeNameById, companyExpenseTotal } = input;

  const rows: RoiRow[] = initiatives.map((initiative) => {
    const revenue = revenueById.get(initiative.id) ?? 0;
    const spend = toCents(spendById.get(initiative.id) ?? 0) / 100;
    const net = revenue - spend;
    const roi = spend > 0 ? ((revenue - spend) / spend) * 100 : null;
    const typeName = typeNameById.get(initiative.initiativeTypeId);
    return {
      id: initiative.id,
      name: initiative.name,
      typeName: typeName || "Unknown",
      revenue,
      spend,
      net,
      roi,
      status: initiative.status,
    };
  });

  rows.sort(byRoiDesc);

  const totalRevenue = rows.reduce((sum, r) => sum + r.revenue, 0);
  const totalSpendCents = rows.reduce((sum, r) => sum + toCents(r.spend), 0);
  const totalSpend = totalSpendCents / 100;

  const typeGroups = new Map<string, { typeName: string; revenue: number; spendCents: number }>();
  for (const item of rows) {
    const existing = typeGroups.get(item.typeName) || {
      typeName: item.typeName,
      revenue: 0,
      spendCents: 0,
    };
    existing.revenue += item.revenue;
    existing.spendCents += toCents(item.spend);
    typeGroups.set(item.typeName, existing);
  }

  const typeRows: RoiTypeRow[] = Array.from(typeGroups.entries()).map(([key, val]) => {
    const spend = val.spendCents / 100;
    return {
      typeId: key,
      typeName: val.typeName,
      totalRevenue: val.revenue,
      totalSpend: spend,
      roi: spend > 0 ? ((val.revenue - spend) / spend) * 100 : null,
    };
  });

  typeRows.sort(byRoiDesc);

  const unattributedSpend = Math.max(0, toCents(companyExpenseTotal) - totalSpendCents) / 100;

  return { rows, typeRows, totalRevenue, totalSpend, unattributedSpend };
}
