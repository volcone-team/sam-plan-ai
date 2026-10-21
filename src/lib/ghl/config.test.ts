import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadGhlConfig,
  readGhlEnv,
  ghlIsOn,
  describeGhlConfig,
  GHL_ENV_LOCATION_ID,
  GHL_ENV_PRIVATE_TOKEN,
  type GhlEnvSource,
} from "./config";

/* ── Mocked Supabase ─────────────────────────────────────────────────────────
 * Same shape as src/lib/access/call-gate-settings.test.ts: records the query
 * chain so a test can assert both what was asked and what was decided.
 */
type Call = { table: string; method: string; args: unknown[] };
let calls: Call[] = [];
let responses: Record<string, { data: unknown; error: unknown }> = {};

function makeDb(): SupabaseClient {
  const db = {
    from(table: string) {
      calls.push({ table, method: "from", args: [table] });
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq"]) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        };
      }
      builder.maybeSingle = () => {
        calls.push({ table, method: "maybeSingle", args: [] });
        return Promise.resolve(responses[table] ?? { data: null, error: null });
      };
      return builder;
    },
  };
  return db as unknown as SupabaseClient;
}

const throwingDb = {
  from() {
    throw new Error("boom");
  },
} as unknown as SupabaseClient;

/** PostgREST's "column does not exist" — what an unapplied 044 looks like. */
const MISSING_COLUMN = {
  code: "42703",
  message: "column app_settings.ghl_enabled does not exist",
};

const LOCATION = "loc_abc123";
const TOKEN = "pit-0123456789abcdef";

/** Both credentials set. Never read from the real environment. */
const FULL_ENV: GhlEnvSource = {
  [GHL_ENV_LOCATION_ID]: LOCATION,
  [GHL_ENV_PRIVATE_TOKEN]: TOKEN,
};

function settings(over: Record<string, unknown> = {}) {
  responses.app_settings = {
    data: { ghl_enabled: true, ghl_dry_run: false, ...over },
    error: null,
  };
}

beforeEach(() => {
  calls = [];
  responses = {};
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readGhlEnv", () => {
  it("reads both credentials", () => {
    const out = readGhlEnv(FULL_ENV);
    expect(out.credentials).toEqual({ locationId: LOCATION, token: TOKEN });
    expect(out.missing).toEqual([]);
    expect(out.presence).toEqual({ locationId: true, token: true });
  });

  it("names the variables that are missing", () => {
    expect(readGhlEnv({}).missing).toEqual([GHL_ENV_LOCATION_ID, GHL_ENV_PRIVATE_TOKEN]);
    expect(readGhlEnv({ [GHL_ENV_LOCATION_ID]: LOCATION }).missing).toEqual([
      GHL_ENV_PRIVATE_TOKEN,
    ]);
    expect(readGhlEnv({ [GHL_ENV_PRIVATE_TOKEN]: TOKEN }).missing).toEqual([
      GHL_ENV_LOCATION_ID,
    ]);
  });

  /**
   * Vercel's UI will store a variable whose value is a space, and an empty
   * string in a .env file looks exactly like a typo. "Present but blank" is
   * never a working credential.
   */
  it("treats a blank or whitespace value as absent", () => {
    for (const blank of ["", " ", "\t\n"]) {
      const out = readGhlEnv({
        [GHL_ENV_LOCATION_ID]: blank,
        [GHL_ENV_PRIVATE_TOKEN]: blank,
      });
      expect(out.credentials).toBeNull();
      expect(out.presence).toEqual({ locationId: false, token: false });
    }
  });

  it("trims a value that is otherwise usable", () => {
    const out = readGhlEnv({
      [GHL_ENV_LOCATION_ID]: `  ${LOCATION}  `,
      [GHL_ENV_PRIVATE_TOKEN]: `\n${TOKEN}\n`,
    });
    expect(out.credentials).toEqual({ locationId: LOCATION, token: TOKEN });
  });
});

describe("loadGhlConfig", () => {
  it("is live when all four inputs say so", async () => {
    settings({ ghl_enabled: true, ghl_dry_run: false });

    const config = await loadGhlConfig(makeDb(), { env: FULL_ENV });

    expect(config).toEqual({
      status: "live",
      available: true,
      env: { locationId: true, token: true },
      mayWrite: true,
      credentials: { locationId: LOCATION, token: TOKEN },
    });
    // Reads the singleton, like every other app_settings consumer.
    expect(calls.find((c) => c.method === "eq")?.args).toEqual(["id", "global"]);
  });

  it("is a dry run when the dry-run flag is on, and carries no credentials", async () => {
    settings({ ghl_enabled: true, ghl_dry_run: true });

    const config = await loadGhlConfig(makeDb(), { env: FULL_ENV });

    expect(config.status).toBe("dry_run");
    expect(config.mayWrite).toBe(false);
    /*
     * The whole point of a dry run is that it CANNOT write. Withholding the
     * token means a drain wired up wrongly has nothing to call GHL with.
     */
    expect(config).not.toHaveProperty("credentials");
  });

  it("is disabled when the switch is off, even with everything else ready", async () => {
    settings({ ghl_enabled: false, ghl_dry_run: false });

    const config = await loadGhlConfig(makeDb(), { env: FULL_ENV });

    expect(config.status).toBe("disabled");
    expect(config.mayWrite).toBe(false);
  });

  /**
   * "I switched it off" wins over "and also the token is missing": an operator
   * who deliberately disabled the integration should not be nagged about
   * credentials for it.
   */
  it("reports disabled rather than not_configured when both are true", async () => {
    settings({ ghl_enabled: false });
    expect((await loadGhlConfig(makeDb(), { env: {} })).status).toBe("disabled");
  });

  it("is not_configured when enabled without credentials, and says which", async () => {
    settings({ ghl_enabled: true, ghl_dry_run: false });

    const config = await loadGhlConfig(makeDb(), {
      env: { [GHL_ENV_LOCATION_ID]: LOCATION },
    });

    expect(config).toMatchObject({
      status: "not_configured",
      mayWrite: false,
      missing: [GHL_ENV_PRIVATE_TOKEN],
      env: { locationId: true, token: false },
    });
  });

  /** A missing credential beats the dry-run flag: it is not a working setup. */
  it("prefers not_configured over dry_run", async () => {
    settings({ ghl_enabled: true, ghl_dry_run: true });
    expect((await loadGhlConfig(makeDb(), { env: {} })).status).toBe("not_configured");
  });

  /**
   * THE INVARIANT. Migration 044 is applied by hand, so this code ships
   * before the columns exist — and an unreadable setting must never be read as
   * permission to write into the client's live CRM.
   */
  it("does not sync when the column does not exist, and says the migration is missing", async () => {
    responses.app_settings = { data: null, error: MISSING_COLUMN };

    const config = await loadGhlConfig(makeDb(), { env: FULL_ENV });

    expect(config).toEqual({
      status: "unavailable",
      available: false,
      env: { locationId: true, token: true },
      mayWrite: false,
    });
  });

  it("does not sync when the read fails for any other reason", async () => {
    responses.app_settings = {
      data: null,
      error: { code: "08006", message: "connection failure" },
    };

    const config = await loadGhlConfig(makeDb(), { env: FULL_ENV });

    // available stays true: a dropped connection says nothing about whether
    // the columns exist, and sending an operator to the SQL editor would be a
    // wrong diagnosis.
    expect(config).toMatchObject({ status: "unavailable", available: true, mayWrite: false });
  });

  it("does not sync when there is no singleton row", async () => {
    responses.app_settings = { data: null, error: null };
    expect(await loadGhlConfig(makeDb(), { env: FULL_ENV })).toMatchObject({
      status: "unavailable",
      mayWrite: false,
    });
  });

  it("does not sync, and does not throw, when the client throws", async () => {
    await expect(loadGhlConfig(throwingDb, { env: FULL_ENV })).resolves.toMatchObject({
      status: "unavailable",
      available: true,
      mayWrite: false,
    });
  });

  /**
   * The two columns default the opposite way round, so a NULL in either must
   * land on the cautious side: NULL enabled is off, NULL dry_run is a dry run.
   */
  it("treats a null switch as off and a null dry-run flag as a dry run", async () => {
    settings({ ghl_enabled: null, ghl_dry_run: false });
    expect((await loadGhlConfig(makeDb(), { env: FULL_ENV })).status).toBe("disabled");

    settings({ ghl_enabled: true, ghl_dry_run: null });
    expect((await loadGhlConfig(makeDb(), { env: FULL_ENV })).status).toBe("dry_run");
  });

  it("does not take a truthy non-boolean for an answer in either direction", async () => {
    settings({ ghl_enabled: 1, ghl_dry_run: 0 });
    // 1 is not true, so: off. 0 is not false, so it would have been a dry run.
    expect((await loadGhlConfig(makeDb(), { env: FULL_ENV })).status).toBe("disabled");

    settings({ ghl_enabled: true, ghl_dry_run: "false" });
    expect((await loadGhlConfig(makeDb(), { env: FULL_ENV })).status).toBe("dry_run");
  });

  /**
   * Every combination, stated once as a table. The thing being asserted is
   * that `mayWrite` is true in EXACTLY ONE of them.
   */
  it("only ever writes in the single fully-configured, fully-enabled case", async () => {
    const envs: [string, GhlEnvSource][] = [
      ["both", FULL_ENV],
      ["location only", { [GHL_ENV_LOCATION_ID]: LOCATION }],
      ["token only", { [GHL_ENV_PRIVATE_TOKEN]: TOKEN }],
      ["neither", {}],
    ];
    const rows: [string, Record<string, unknown> | null][] = [
      ["on, live", { ghl_enabled: true, ghl_dry_run: false }],
      ["on, dry", { ghl_enabled: true, ghl_dry_run: true }],
      ["off, live", { ghl_enabled: false, ghl_dry_run: false }],
      ["off, dry", { ghl_enabled: false, ghl_dry_run: true }],
      ["no row", null],
    ];

    const writable: string[] = [];
    for (const [envName, env] of envs) {
      for (const [rowName, row] of rows) {
        responses.app_settings = row
          ? { data: row, error: null }
          : { data: null, error: null };
        const config = await loadGhlConfig(makeDb(), { env });
        if (config.mayWrite) writable.push(`${envName} / ${rowName}`);
      }
    }

    expect(writable).toEqual(["both / on, live"]);
  });

  /**
   * So the admin screen can warn about an unset token before the operator
   * flips the switch and finds out the hard way.
   */
  it("reports credential presence on every status", async () => {
    const env: GhlEnvSource = { [GHL_ENV_LOCATION_ID]: LOCATION };

    settings({ ghl_enabled: false });
    expect((await loadGhlConfig(makeDb(), { env })).env).toEqual({
      locationId: true,
      token: false,
    });

    responses.app_settings = { data: null, error: MISSING_COLUMN };
    expect((await loadGhlConfig(makeDb(), { env })).env).toEqual({
      locationId: true,
      token: false,
    });

    expect((await loadGhlConfig(throwingDb, { env })).env).toEqual({
      locationId: true,
      token: false,
    });
  });

  /** Nothing is allowed to put the token in a log line. */
  it("never logs the token", async () => {
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });

    // Every path that logs anything at all.
    responses.app_settings = {
      data: null,
      error: { code: "08006", message: "connection failure" },
    };
    await loadGhlConfig(makeDb(), { env: FULL_ENV });
    responses.app_settings = { data: null, error: null };
    await loadGhlConfig(makeDb(), { env: FULL_ENV });
    await loadGhlConfig(throwingDb, { env: FULL_ENV });

    expect(logged.length).toBe(3);
    expect(logged.join("\n")).not.toContain(TOKEN);
    expect(logged.join("\n")).not.toContain(LOCATION);
  });
});

describe("ghlIsOn", () => {
  it("is true for live and for a dry run, and false otherwise", async () => {
    const expected: Record<string, boolean> = {
      live: true,
      dry_run: true,
      disabled: false,
      not_configured: false,
      unavailable: false,
    };

    settings({ ghl_enabled: true, ghl_dry_run: false });
    const live = await loadGhlConfig(makeDb(), { env: FULL_ENV });
    settings({ ghl_enabled: true, ghl_dry_run: true });
    const dry = await loadGhlConfig(makeDb(), { env: FULL_ENV });
    settings({ ghl_enabled: false });
    const off = await loadGhlConfig(makeDb(), { env: FULL_ENV });
    settings({ ghl_enabled: true });
    const unset = await loadGhlConfig(makeDb(), { env: {} });
    responses.app_settings = { data: null, error: MISSING_COLUMN };
    const gone = await loadGhlConfig(makeDb(), { env: FULL_ENV });

    for (const config of [live, dry, off, unset, gone]) {
      expect(ghlIsOn(config)).toBe(expected[config.status]);
    }
  });
});

describe("describeGhlConfig", () => {
  it("names the missing variables so an operator knows what to set", async () => {
    settings({ ghl_enabled: true });
    const config = await loadGhlConfig(makeDb(), { env: {} });

    const text = describeGhlConfig(config);
    expect(text).toContain(GHL_ENV_LOCATION_ID);
    expect(text).toContain(GHL_ENV_PRIVATE_TOKEN);
  });

  it("distinguishes an unapplied migration from an unreadable table", async () => {
    responses.app_settings = { data: null, error: MISSING_COLUMN };
    expect(describeGhlConfig(await loadGhlConfig(makeDb(), { env: FULL_ENV }))).toContain("044");

    responses.app_settings = { data: null, error: { code: "08006", message: "down" } };
    expect(describeGhlConfig(await loadGhlConfig(makeDb(), { env: FULL_ENV }))).not.toContain(
      "044"
    );
  });

  /** A status line ends up in support tickets and screenshots. */
  it("never includes a credential, not even the location id", async () => {
    settings({ ghl_enabled: true, ghl_dry_run: false });
    const config = await loadGhlConfig(makeDb(), { env: FULL_ENV });

    const text = describeGhlConfig(config);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(LOCATION);
  });
});
