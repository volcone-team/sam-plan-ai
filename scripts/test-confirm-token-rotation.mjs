/**
 * Email-confirmation behaviour, verified against the live auth server rather
 * than assumed. Sends NO real email: tokens come from generateLink, and the
 * only resend attempted is one Supabase refuses before sending anything.
 *
 *   1. Rotation: does issuing token B invalidate token A?
 *   2. Throttle: what does resend() return inside the cooldown window?
 *
 * Creates one throwaway unconfirmed user and deletes it (plus the company the
 * signup trigger makes) at the end. Touches nothing else.
 *
 * Run: node scripts/test-confirm-token-rotation.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);

const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = () =>
  createClient(URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const email = `token-rotation-test+${Date.now()}@example.com`;
const password = `Tmp-${Math.random().toString(36).slice(2)}-Aa1!`;

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

let userId = null;
try {
  const { data: link1, error: e1 } = await admin.auth.admin.generateLink({
    type: "signup", email, password,
  });
  if (e1) throw new Error("generateLink A: " + e1.message);
  userId = link1.user.id;
  const tokenA = link1.properties.hashed_token;

  // --- Throttle: resend immediately after a token was issued ---------------
  const throttled = await anon().auth.resend({ type: "signup", email });
  console.log("resend inside window ->", {
    status: throttled.error?.status,
    code: throttled.error?.code,
    message: throttled.error?.message,
  });
  check(
    "resend inside the cooldown is REFUSED (so no new token, old link stays valid)",
    !!throttled.error
  );

  // --- Rotation ------------------------------------------------------------
  console.log("Waiting 65s so the next issue is a real rotation...");
  await new Promise((r) => setTimeout(r, 65_000));

  const { data: link2, error: e2 } = await admin.auth.admin.generateLink({
    type: "signup", email, password,
  });
  if (e2) throw new Error("generateLink B: " + e2.message);
  const tokenB = link2.properties.hashed_token;

  check("token B differs from token A", tokenA !== tokenB);

  const oldTry = await anon().auth.verifyOtp({ type: "signup", token_hash: tokenA });
  check("OLD token A rejected after rotation", !!oldTry.error, oldTry.error?.message);

  const newTry = await anon().auth.verifyOtp({ type: "signup", token_hash: tokenB });
  check("NEW token B accepted", !newTry.error, newTry.error?.message);
} catch (err) {
  console.error("Test error:", err.message);
  failures++;
} finally {
  if (userId) {
    const { data: profile } = await admin
      .from("profiles").select("company_id").eq("id", userId).maybeSingle();
    await admin.auth.admin.deleteUser(userId);
    if (profile?.company_id) {
      await admin.from("companies").delete().eq("id", profile.company_id);
    }
    console.log("Cleaned up throwaway user and company.");
  }
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
