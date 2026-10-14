import { describe, it, expect, afterEach, vi } from "vitest";
import { getAppUrl, absoluteUrl } from "./app-url";

/**
 * The bug these guard: a confirmation email carrying an http:// link.
 *
 * The base URL for every emailed link comes from here, and the old
 * implementation returned an explicit `http://…` untouched — so one typo in
 * NEXT_PUBLIC_APP_URL downgraded every link we mailed. Loopback is the only
 * place plain http is legitimate.
 */

const ENV_KEYS = [
  "NEXT_PUBLIC_APP_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
] as const;

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(() => {
  clearEnv();
  vi.unstubAllGlobals();
});

describe("getAppUrl — scheme handling", () => {
  it("upgrades an http override to https", () => {
    clearEnv();
    process.env.NEXT_PUBLIC_APP_URL = "http://app.samplan.ai";
    expect(getAppUrl()).toBe("https://app.samplan.ai");
  });

  it("leaves an https override alone", () => {
    clearEnv();
    process.env.NEXT_PUBLIC_APP_URL = "https://app.samplan.ai";
    expect(getAppUrl()).toBe("https://app.samplan.ai");
  });

  it("adds https to a bare host", () => {
    clearEnv();
    process.env.NEXT_PUBLIC_APP_URL = "app.samplan.ai";
    expect(getAppUrl()).toBe("https://app.samplan.ai");
  });

  /** Vercel supplies these without a scheme. */
  it("adds https to the Vercel production host", () => {
    clearEnv();
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "sam-plan-ai.vercel.app";
    expect(getAppUrl()).toBe("https://sam-plan-ai.vercel.app");
  });

  it("adds https to a Vercel preview host", () => {
    clearEnv();
    process.env.VERCEL_URL = "sam-plan-ai-git-abc123.vercel.app";
    expect(getAppUrl()).toBe("https://sam-plan-ai-git-abc123.vercel.app");
  });

  it("prefers the explicit override over Vercel's hosts", () => {
    clearEnv();
    process.env.NEXT_PUBLIC_APP_URL = "https://app.samplan.ai";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "sam-plan-ai.vercel.app";
    expect(getAppUrl()).toBe("https://app.samplan.ai");
  });

  it("strips a trailing slash so paths can be appended", () => {
    clearEnv();
    process.env.NEXT_PUBLIC_APP_URL = "https://app.samplan.ai/";
    expect(getAppUrl()).toBe("https://app.samplan.ai");
    expect(absoluteUrl("/settings")).toBe("https://app.samplan.ai/settings");
  });
});

/**
 * LOOPBACK KEEPS HTTP. A dev machine has no certificate, and forcing https
 * would break every local email link.
 */
describe("getAppUrl — loopback stays http", () => {
  it("keeps http for localhost with a port", () => {
    clearEnv();
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    expect(getAppUrl()).toBe("http://localhost:3000");
  });

  it("keeps http for 127.0.0.1", () => {
    clearEnv();
    process.env.NEXT_PUBLIC_APP_URL = "http://127.0.0.1:3000";
    expect(getAppUrl()).toBe("http://127.0.0.1:3000");
  });

  it("keeps http for a .localhost subdomain", () => {
    clearEnv();
    process.env.NEXT_PUBLIC_APP_URL = "http://sam.localhost:3000";
    expect(getAppUrl()).toBe("http://sam.localhost:3000");
  });

  it("falls back to local dev when nothing is configured", () => {
    clearEnv();
    expect(getAppUrl()).toBe("http://localhost:3000");
  });
});

/**
 * The branch the signup page uses: it is a client component, so
 * `emailRedirectTo` is built from window.location.origin.
 */
describe("getAppUrl — client origin", () => {
  it("upgrades an http origin on a deployed host", () => {
    clearEnv();
    vi.stubGlobal("window", { location: { origin: "http://app.samplan.ai" } });
    expect(getAppUrl()).toBe("https://app.samplan.ai");
  });

  it("keeps a local dev origin as http", () => {
    clearEnv();
    vi.stubGlobal("window", { location: { origin: "http://localhost:3000" } });
    expect(getAppUrl()).toBe("http://localhost:3000");
  });

  it("leaves an https origin alone", () => {
    clearEnv();
    vi.stubGlobal("window", { location: { origin: "https://app.samplan.ai" } });
    expect(getAppUrl()).toBe("https://app.samplan.ai");
  });
});

describe("absoluteUrl", () => {
  it("joins a path whether or not it is prefixed with a slash", () => {
    clearEnv();
    process.env.NEXT_PUBLIC_APP_URL = "https://app.samplan.ai";
    expect(absoluteUrl("/settings")).toBe("https://app.samplan.ai/settings");
    expect(absoluteUrl("settings")).toBe("https://app.samplan.ai/settings");
  });

  it("defaults to the root", () => {
    clearEnv();
    process.env.NEXT_PUBLIC_APP_URL = "https://app.samplan.ai";
    expect(absoluteUrl()).toBe("https://app.samplan.ai/");
  });
});
