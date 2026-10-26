import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PENDING_INPUT_COLUMNS,
  draftRetryRow,
  resetDraftColumnWarning,
  withDraftColumnFallback,
} from "./draft-columns";
import { serialiseAnswers } from "./draft";

const PGRST204 = {
  code: "PGRST204",
  message: "Could not find the 'customer_industries_other' column of 'planning_inputs' in the schema cache",
};
const UNDEFINED_COLUMN = {
  code: "42703",
  message: 'column "customer_industries_other" of relation "planning_inputs" does not exist',
};

const row = () => ({ industry: "Retail", customer_industries_other: "Vets", revenue_goal: 0 });

describe("draftRetryRow — the retry decision", () => {
  it("drops the 053 column on either missing-column error", () => {
    for (const error of [PGRST204, UNDEFINED_COLUMN]) {
      expect(draftRetryRow(row(), error)).toEqual({ industry: "Retail", revenue_goal: 0 });
    }
  });

  it("never retries an error that is not a missing column", () => {
    expect(draftRetryRow(row(), { code: "23505", message: "duplicate key" })).toBeNull();
    expect(draftRetryRow(row(), { code: "23514", message: "check violation" })).toBeNull();
    expect(draftRetryRow(row(), null)).toBeNull();
  });

  it("does not retry when the row carries no pending column", () => {
    expect(draftRetryRow({ industry: "Retail" }, PGRST204)).toBeNull();
  });

  it("does not mutate the original row", () => {
    const original = row();
    draftRetryRow(original, PGRST204);
    expect(original).toHaveProperty("customer_industries_other", "Vets");
  });

  it("covers the column every serialised draft writes", () => {
    const serialised = serialiseAnswers({ answers: {}, products: [], initiatives: [], resumeScreen: "start" });
    for (const column of PENDING_INPUT_COLUMNS) expect(serialised).toHaveProperty(column);
  });
});

describe("withDraftColumnFallback", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetDraftColumnWarning();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  /** A table without the 053 column, as before the migration is applied. */
  const pre053 = (seen: Record<string, unknown>[]) => async (payload: Record<string, unknown>) => {
    seen.push(payload);
    return "customer_industries_other" in payload
      ? { data: null, error: PGRST204 }
      : { data: { id: "pi-1" }, error: null };
  };

  it("saves without the column before 053, and logs once across saves", async () => {
    const seen: Record<string, unknown>[] = [];
    const first = await withDraftColumnFallback(row(), pre053(seen), "[test]");
    const second = await withDraftColumnFallback(row(), pre053(seen), "[test]");

    expect(first).toEqual({ data: { id: "pi-1" }, error: null });
    expect(second.error).toBeNull();
    expect(seen).toHaveLength(4);
    expect(seen[1]).not.toHaveProperty("customer_industries_other");
    expect(seen[1]).toHaveProperty("industry", "Retail");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("writes once with the column after 053", async () => {
    const run = vi.fn(async () => ({ error: null }));
    await withDraftColumnFallback(row(), run, "[test]");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(row());
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns an unrelated error untouched, without retrying", async () => {
    const error = { code: "23505", message: "duplicate key" };
    const run = vi.fn(async () => ({ error }));
    expect(await withDraftColumnFallback(row(), run, "[test]")).toEqual({ error });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
