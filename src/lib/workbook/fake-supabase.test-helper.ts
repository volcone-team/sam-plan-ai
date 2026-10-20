import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A minimal in-memory stand-in for the PostgREST calls the workbook code makes:
 * select(...).order(...).in(...), insert, upsert, delete().neq(...).
 *
 * `schema` lists the columns each table HAS. Selecting or inserting a column
 * outside it fails the way the real API does (42703 on select, PGRST204 on
 * insert), which is what lets tests exercise "migration 040 not applied".
 * A table absent from `schema` accepts any column.
 */
export type Row = Record<string, unknown>;
export interface DbError { code: string; message: string }

export interface FakeOptions {
  tables?: Record<string, Row[]>;
  schema?: Record<string, readonly string[]>;
  /** Fail a specific write: return an error to reject it. */
  failInsert?: (table: string, rows: Row[]) => DbError | null;
}

export interface FakeDb {
  client: SupabaseClient;
  tables: Record<string, Row[]>;
  calls: Array<{ table: string; op: string; rows?: Row[]; columns?: string }>;
  /**
   * Every `rpc()` made through this client. Billing meters usage with
   * `rpc("increment_usage", ...)`, so a test can assert that a code path did
   * NOT charge the customer.
   */
  rpcCalls: Array<{ fn: string; args: Row | undefined }>;
}

export function fakeSupabase(opts: FakeOptions = {}): FakeDb {
  const tables: Record<string, Row[]> = { ...(opts.tables ?? {}) };
  const calls: FakeDb["calls"] = [];

  const unknownColumn = (table: string, columns: readonly string[]): string | null => {
    const known = opts.schema?.[table];
    if (!known) return null;
    return columns.find((c) => !known.includes(c)) ?? null;
  };

  const from = (table: string) => ({
    select(columns: string) {
      calls.push({ table, op: "select", columns });
      const cols = columns.split(",").map((c) => c.trim()).filter(Boolean);
      let filters: Array<(r: Row) => boolean> = [];
      let orderBy: string | null = null;
      const builder = {
        order(col: string) { orderBy = col; return builder; },
        in(col: string, values: readonly unknown[]) {
          filters = [...filters, (r: Row) => values.includes(r[col])];
          return builder;
        },
        then<T>(resolve: (v: { data: Row[] | null; error: DbError | null }) => T) {
          const bad = unknownColumn(table, cols);
          if (bad) {
            return Promise.resolve(resolve({
              data: null,
              error: { code: "42703", message: `column ${table}.${bad} does not exist` },
            }));
          }
          let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          if (orderBy) {
            const key = orderBy;
            rows = [...rows].sort((a, b) => Number(a[key] ?? 0) - Number(b[key] ?? 0));
          }
          const data = rows.map((r) => Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])));
          return Promise.resolve(resolve({ data, error: null }));
        },
      };
      return builder;
    },
    insert(input: Row[] | Row) {
      // supabase-js accepts one row or many; normalised so a caller that
      // inserts a single object (logGenerationEvent) behaves like the real API.
      const rows = Array.isArray(input) ? input : [input];
      calls.push({ table, op: "insert", rows });
      const bad = unknownColumn(table, [...new Set(rows.flatMap((r) => Object.keys(r)))]);
      if (bad) {
        return Promise.resolve({
          error: { code: "PGRST204", message: `Could not find the '${bad}' column of '${table}' in the schema cache` },
        });
      }
      const injected = opts.failInsert?.(table, rows) ?? null;
      if (injected) return Promise.resolve({ error: injected });
      tables[table] = [...(tables[table] ?? []), ...rows];
      return Promise.resolve({ error: null });
    },
    upsert(rows: Row[]) {
      calls.push({ table, op: "upsert", rows });
      const injected = opts.failInsert?.(table, rows) ?? null;
      if (injected) return Promise.resolve({ error: injected });
      tables[table] = [...(tables[table] ?? []), ...rows];
      return Promise.resolve({ error: null });
    },
    delete() {
      return {
        neq() {
          calls.push({ table, op: "delete" });
          tables[table] = [];
          return Promise.resolve({ error: null });
        },
      };
    },
  });

  const rpcCalls: FakeDb["rpcCalls"] = [];
  const rpc = (fn: string, args?: Row) => {
    rpcCalls.push({ fn, args });
    return Promise.resolve({ data: null, error: null });
  };

  return { client: { from, rpc } as unknown as SupabaseClient, tables, calls, rpcCalls };
}
