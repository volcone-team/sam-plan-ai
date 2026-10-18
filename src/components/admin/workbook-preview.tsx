"use client";

import { Fragment, useId, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { METRICS_BY_KEY } from "@/lib/metrics/dictionary";
import type {
  PreviewRow,
  WarningDetail,
  WarningGroup,
  WorkbookPreview,
} from "@/lib/workbook/preview";

/**
 * The confirm step between choosing a workbook and saving it.
 *
 * Everything shown here comes from `buildWorkbookPreview`, run in the browser
 * on exactly the sheets the Confirm button will POST. Nothing has been sent
 * to the server yet.
 */

export interface LiveLibraryEntry {
  initiativeKey: string;
  name: string;
  isActive: boolean;
}

interface WorkbookPreviewPanelProps {
  fileName: string;
  preview: WorkbookPreview;
  /** Live library entries, for naming removed keys. Null when unavailable. */
  liveLibrary: LiveLibraryEntry[] | null;
  /** Set when the live library could not be fetched; the diff is then omitted. */
  liveError: string | null;
  confirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

type RowFilter = "all" | "warnings" | "variants";

const tagLabel = (key: string): string => METRICS_BY_KEY.get(key)?.label ?? key;

export function WorkbookPreviewPanel({
  fileName, preview, liveLibrary, liveError, confirming, onConfirm, onCancel,
}: WorkbookPreviewPanelProps) {
  const headingId = useId();
  const { counts, warningGroups, diff } = preview;

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-4 rounded-md border border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--primary)/0.03)] p-4"
    >
      <div>
        <h4 id={headingId} className="text-sm font-semibold text-[hsl(var(--foreground))]">
          Preview: {fileName}
        </h4>
        <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">
          Nothing has been uploaded yet. Check what this workbook will do, then confirm or cancel.
        </p>
      </div>

      {/* Summary counts */}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {([
          ["Initiatives", counts.initiatives],
          ["Variants", counts.variants],
          ["AI context rows", counts.aiContext],
          ["Task templates", counts.taskTemplates],
          ["Benchmarks", counts.benchmarks],
          ["Warnings", counts.warnings],
        ] as const).map(([label, value]) => (
          <div key={label} className="rounded-md border border-border bg-card px-3 py-2">
            <dt className="text-[11px] text-[hsl(var(--foreground-muted))]">{label}</dt>
            <dd
              className={cn(
                "text-lg font-semibold",
                label === "Warnings" && value > 0
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-[hsl(var(--foreground))]"
              )}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <LibraryDiff diff={diff} liveLibrary={liveLibrary} liveError={liveError} />

      {warningGroups.length > 0 ? (
        <div>
          <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--foreground-muted))]">
            Warnings
          </h5>
          <WarningGroupList groups={warningGroups} />
        </div>
      ) : (
        <p className="text-xs text-green-700 dark:text-green-400">No warnings.</p>
      )}

      <LibraryTable rows={preview.rows} />

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirming}
          className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] focus-visible:ring-offset-2"
        >
          {confirming && (
            <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
          )}
          {confirming ? "Uploading…" : "Confirm upload"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={confirming}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]"
        >
          Cancel
        </button>
        <span className="text-xs text-[hsl(var(--foreground-muted))]">
          Confirming replaces the live library with this one.
        </span>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Diff
 * ------------------------------------------------------------------ */

function KeyList({ keys }: { keys: string[] }) {
  if (keys.length === 0) return <p className="text-xs text-[hsl(var(--foreground-muted))]">None.</p>;
  return (
    <ul className="flex flex-wrap gap-1">
      {keys.map((k) => (
        <li key={k} className="rounded bg-[hsl(var(--foreground)/0.06)] px-1.5 py-0.5 font-mono text-[11px] text-[hsl(var(--foreground))]">
          {k}
        </li>
      ))}
    </ul>
  );
}

function LibraryDiff({
  diff, liveLibrary, liveError,
}: { diff: WorkbookPreview["diff"]; liveLibrary: LiveLibraryEntry[] | null; liveError: string | null }) {
  if (!diff) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2">
        <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--foreground-muted))]" />
        <p className="text-xs text-[hsl(var(--foreground-muted))]">
          Couldn&apos;t load the current live library{liveError ? ` (${liveError})` : ""}, so this preview
          can&apos;t show which initiatives are new or removed. The rest of the preview is complete.
        </p>
      </div>
    );
  }

  const byKey = new Map((liveLibrary ?? []).map((e) => [e.initiativeKey, e]));
  return (
    <div className="space-y-3">
      <h5 className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--foreground-muted))]">
        Changes vs the current live library
      </h5>

      {diff.removed.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700/50 dark:bg-amber-900/10">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
            <AlertTriangle aria-hidden="true" className="h-4 w-4" />
            {diff.removed.length} initiative{diff.removed.length === 1 ? "" : "s"} will be removed
          </p>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            Customer initiatives already created from these keep working, but the AI won&apos;t offer them
            anymore. Admin on/off settings for them are kept and apply again if the key comes back.
          </p>
          <ul className="mt-2 space-y-0.5">
            {diff.removed.map((k) => {
              const entry = byKey.get(k);
              return (
                <li key={k} className="text-xs text-amber-900 dark:text-amber-200">
                  <span className="font-mono">{k}</span>
                  {entry && <> — {entry.name}{entry.isActive ? "" : " (currently switched off)"}</>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-medium text-[hsl(var(--foreground))]">New ({diff.added.length})</p>
          <KeyList keys={diff.added} />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-[hsl(var(--foreground))]">Unchanged keys ({diff.unchanged.length})</p>
          <details>
            <summary className="cursor-pointer text-xs text-[hsl(var(--foreground-muted))]">Show keys</summary>
            <div className="mt-1"><KeyList keys={diff.unchanged} /></div>
          </details>
        </div>
      </div>
      {diff.removed.length === 0 && (
        <p className="text-xs text-[hsl(var(--foreground-muted))]">No live initiatives are removed.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Warnings
 * ------------------------------------------------------------------ */

function DetailView({ detail }: { detail: WarningDetail }) {
  const mono = "font-mono text-[11px]";
  switch (detail.kind) {
    case "variants":
      return (
        <ul className="mt-1 space-y-0.5 pl-3">
          <li><span className={mono}>{detail.baseKey}</span> — first listing ({detail.firstListing})</li>
          {detail.variants.map((v) => (
            <li key={v.key}>
              <span className={mono}>{v.key}</span> — {v.listing} <span className="text-[hsl(var(--foreground-muted))]">(told apart by {v.reason})</span>
            </li>
          ))}
        </ul>
      );
    case "sharedId":
      return (
        <ul className="mt-1 space-y-0.5 pl-3">
          {detail.listings.map((l) => (
            <li key={l.key}>{l.name} → <span className={mono}>{l.key}</span></li>
          ))}
        </ul>
      );
    case "score":
      return (
        <ul className="mt-1 list-disc space-y-0.5 pl-6">
          {detail.problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      );
    case "metrics":
      return (
        <ul className="mt-1 flex flex-wrap gap-1 pl-3">
          {detail.unrecognised.map((u) => (
            <li key={u} className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">{u}</li>
          ))}
        </ul>
      );
    default:
      return null;
  }
}

/** Grouped warnings. Shared by the preview and the post-upload ingest result. */
export function WarningGroupList({ groups }: { groups: WarningGroup[] }) {
  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <details key={g.id} className="rounded-md border border-border bg-card" open={g.id !== "other" && g.items.length <= 5}>
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-[hsl(var(--foreground))]">
            {g.heading} <span className="text-[hsl(var(--foreground-muted))]">({g.items.length})</span>
          </summary>
          <ul className="space-y-2 border-t border-border px-3 py-2">
            {g.items.map((item, i) => (
              <li key={i} className="text-xs text-[hsl(var(--foreground))]">
                <p>
                  {item.message}
                  {item.origin === "preview" && (
                    <span className="ml-1 rounded bg-[hsl(var(--foreground)/0.06)] px-1 text-[10px] text-[hsl(var(--foreground-muted))]">
                      preview check
                    </span>
                  )}
                </p>
                {item.detail && <DetailView detail={item.detail} />}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Library table
 * ------------------------------------------------------------------ */

const SCORE_COLUMNS: Array<[keyof PreviewRow["scores"], string, string]> = [
  ["speed", "S", "Speed"], ["cost", "C", "Cost"], ["odds", "O", "Odds"],
  ["revenue", "R", "Revenue"], ["ease", "E", "Ease"],
];

/** Expand, key, name, ID, Own/Ops, category + scores + total, industries, metrics, tags. */
const COLUMN_COUNT = 6 + SCORE_COLUMNS.length + 4;

function LibraryTable({ rows }: { rows: PreviewRow[] }) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RowFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "warnings" && r.warnings.length === 0) return false;
      if (filter === "variants" && !r.baseKey) return false;
      if (!q) return true;
      return [r.key, r.name, r.workbookId, r.category, r.ownOrOps]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [rows, query, filter]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const filters: Array<[RowFilter, string, number]> = [
    ["all", "All", rows.length],
    ["warnings", "Has warnings", rows.filter((r) => r.warnings.length > 0).length],
    ["variants", "Variants", rows.filter((r) => r.baseKey).length],
  ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={searchId} className="text-xs font-medium text-[hsl(var(--foreground))]">
            Search initiatives
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Key, name, ID or category"
            className="w-64 rounded-md border border-border bg-card px-2 py-1 text-xs text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]"
          />
        </div>
        <div role="group" aria-label="Filter initiatives" className="flex gap-1">
          {filters.map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={cn(
                "rounded-md border px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]",
                filter === id
                  ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--foreground))]"
                  : "border-border text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))]"
              )}
            >
              {label} ({n})
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-xs">
          <caption className="px-3 py-2 text-left text-xs font-semibold text-[hsl(var(--foreground))]">
            Initiative library in this workbook — showing {visible.length} of {rows.length}
          </caption>
          <thead className="bg-[hsl(var(--foreground)/0.03)] text-[hsl(var(--foreground-muted))]">
            <tr>
              <th scope="col" className="px-2 py-1.5"><span className="sr-only">Details</span></th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">Key</th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">Name</th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">ID</th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">Own/Ops</th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">Category</th>
              {SCORE_COLUMNS.map(([k, letter, label]) => (
                <th key={k} scope="col" className="px-1.5 py-1.5 text-center font-medium">
                  <abbr title={label}>{letter}</abbr>
                </th>
              ))}
              <th scope="col" className="px-1.5 py-1.5 text-center font-medium">Total</th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">Industries</th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                Metrics <span className="font-normal">(entered / derived)</span>
              </th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">Tags</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={COLUMN_COUNT} className="px-3 py-4 text-center text-[hsl(var(--foreground-muted))]">
                  No initiatives match.
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const open = expanded.has(r.key);
              const detailId = `wb-preview-${r.key}`;
              return (
                <Fragment key={r.key}>
                  <tr className={cn("border-t border-border/60 align-top", r.warnings.length > 0 && "bg-amber-50/50 dark:bg-amber-900/5")}>
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={open ? detailId : undefined}
                        onClick={() => toggle(r.key)}
                        className="rounded p-0.5 hover:bg-[hsl(var(--foreground)/0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]"
                      >
                        {open
                          ? <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
                          : <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />}
                        <span className="sr-only">{open ? "Hide" : "Show"} details for {r.name}</span>
                      </button>
                    </td>
                    <th scope="row" className="px-2 py-1.5 text-left font-mono font-normal text-[11px] text-[hsl(var(--foreground))] whitespace-nowrap">
                      {r.key}
                      {r.warnings.length > 0 && (
                        <span className="ml-1 text-amber-600 dark:text-amber-400" title={`${r.warnings.length} warning(s)`}>
                          <AlertTriangle aria-hidden="true" className="inline h-3 w-3" />
                          <span className="sr-only">{r.warnings.length} warning(s)</span>
                        </span>
                      )}
                    </th>
                    <td className="px-2 py-1.5 text-[hsl(var(--foreground))]">
                      {r.name}
                      {r.baseKey && (
                        <span className="ml-1 whitespace-nowrap rounded bg-[hsl(var(--primary)/0.1)] px-1 text-[10px] text-[hsl(var(--primary))]">
                          variant of {r.baseName ?? r.baseKey}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.workbookId ?? "—"}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.ownOrOps ?? "—"}</td>
                    <td className="px-2 py-1.5 max-w-[160px]">{r.category ?? "—"}</td>
                    {SCORE_COLUMNS.map(([k]) => (
                      <td key={k} className={cn("px-1.5 py-1.5 text-center", r.scores[k] === null && "text-amber-600 dark:text-amber-400")}>
                        {r.scores[k] ?? "—"}
                      </td>
                    ))}
                    <td className="px-1.5 py-1.5 text-center font-semibold">{r.scoreTotal ?? "—"}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {r.industries.length === 0 ? "—" : (
                        <span title={r.industries.join(", ")}>
                          {r.industries.length}
                          <span className="sr-only">: {r.industries.join(", ")}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {r.enteredMetricCount} / {r.derivedMetricCount}
                      {r.metrics.unrecognised.length > 0 && (
                        <span className="ml-1 text-amber-600 dark:text-amber-400">
                          +{r.metrics.unrecognised.length} unrecognised
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.tags.length === 0 ? "—" : r.tags.map(tagLabel).join(", ")}
                    </td>
                  </tr>
                  {open && (
                    <tr id={detailId} className="border-t border-border/30 bg-[hsl(var(--foreground)/0.02)]">
                      <td colSpan={COLUMN_COUNT} className="px-4 py-3">
                        <RowDetails row={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowDetails({ row }: { row: PreviewRow }) {
  const label = "mb-1 text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--foreground-muted))]";
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3">
        <div>
          <p className={label}>Parsed metrics</p>
          {row.metrics.groups.length === 0 ? (
            <p className="text-xs text-[hsl(var(--foreground-muted))]">No recognised metrics.</p>
          ) : (
            <div className="space-y-2">
              {row.metrics.groups.map((g, gi) => (
                <div key={gi}>
                  {g.label && <p className="text-xs font-medium text-[hsl(var(--foreground))]">{g.label}</p>}
                  <ul className="mt-0.5 flex flex-wrap gap-1">
                    {g.metrics.map((m) => (
                      <li
                        key={m.key}
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[11px]",
                          m.source === "derived"
                            ? "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200"
                            : "bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-200"
                        )}
                      >
                        {m.label}
                        <span className="ml-1 opacity-70">({m.source}{m.optional ? ", optional" : ""})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
        {row.metrics.unrecognised.length > 0 && (
          <div>
            <p className={label}>Not recognised</p>
            <ul className="list-disc pl-5 text-xs text-amber-800 dark:text-amber-300">
              {row.metrics.unrecognised.map((u) => <li key={u}>{u}</li>)}
            </ul>
          </div>
        )}
        {row.metrics.notes.length > 0 && (
          <div>
            <p className={label}>Notes</p>
            <ul className="list-disc pl-5 text-xs">{row.metrics.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </div>
        )}
        {row.tags.length > 0 && (
          <div>
            <p className={label}>Tags</p>
            <ul className="flex flex-wrap gap-1 text-xs">
              {row.tags.map((t) => <li key={t} className="rounded bg-[hsl(var(--foreground)/0.06)] px-1.5 py-0.5">{tagLabel(t)}</li>)}
            </ul>
          </div>
        )}
        {row.industries.length > 0 && (
          <div>
            <p className={label}>Ideal industries</p>
            <p className="text-xs">{row.industries.join(", ")}</p>
          </div>
        )}
        {row.warnings.length > 0 && (
          <div>
            <p className={label}>Warnings for this initiative</p>
            <ul className="list-disc pl-5 text-xs text-amber-800 dark:text-amber-300">
              {row.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}
      </div>
      <div>
        <p className={label}>Metrics cell as written</p>
        {row.metricsRaw ? (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-border bg-card p-2 text-[11px]">
            {row.metricsRaw}
          </pre>
        ) : (
          <p className="text-xs text-[hsl(var(--foreground-muted))]">Blank.</p>
        )}
      </div>
    </div>
  );
}
