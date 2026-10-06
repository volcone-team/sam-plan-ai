/**
 * Smallest possible live check that the Anthropic key and model work.
 *
 * A valid-LOOKING key still fails generation if it is revoked, out of credit,
 * or the configured model name is wrong — and that failure surfaces to the user
 * as a generic "could not finish your plan". One ~15-token call distinguishes
 * "the key is broken" from "the plan logic is broken".
 *
 * Costs a fraction of a cent. Never prints the key.
 *
 *   node scripts/check-anthropic.mjs
 */

import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// Same resolution order as the generation route.
const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

async function check(label, apiKey) {
  if (!apiKey) {
    console.log(`  warn  ${label}: not set`);
    return;
  }
  try {
    const res = await new Anthropic({ apiKey }).messages.create({
      model,
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with the word OK only." }],
    });
    const text = res.content.find((b) => b.type === "text")?.text?.trim();
    console.log(`  ok    ${label}: reachable, replied "${text}"`);
  } catch (err) {
    const message = String(err?.message ?? err);

    /**
     * Credit exhaustion arrives as a 400 invalid_request_error — the same
     * status and type as a malformed request — so without matching the message
     * it reads as "the request was wrong" and sends you to debug the prompt
     * instead of topping up the account.
     */
    if (/credit balance is too low|insufficient credit/i.test(message)) {
      console.log(`  FAIL  ${label}: OUT OF CREDIT`);
      console.log("        Add credit at console.anthropic.com → Plans & Billing.");
      console.log("        Plan generation, enhance and chat all fail until then.");
      return;
    }
    if (err?.status === 401 || /api key is invalid|invalid x-api-key/i.test(message)) {
      console.log(`  FAIL  ${label}: key rejected — check the value in .env.local`);
      return;
    }
    console.log(`  FAIL  ${label}: ${err?.status ?? ""} ${message}`);
  }
}

console.log(`\nAnthropic live check (model: ${model})\n`);
// The generation key and the chatbot key are billed separately and can fail
// independently, so both are checked.
await check("ANTHROPIC_API_KEY (generation)", process.env.ANTHROPIC_API_KEY);
await check("ANTHROPIC_API_KEY_CHATBOT (chat)", process.env.ANTHROPIC_API_KEY_CHATBOT);
console.log("");
