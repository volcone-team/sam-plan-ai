import { describe, it, expect, beforeEach, vi } from "vitest";

/* ── Mocked transport ────────────────────────────────────────────────────────
 * The module under test owns the template and delegates delivery to
 * src/lib/mailgun's sendEmail. Mocking that boundary keeps the test on the
 * copy, the recipient and the link, with no network and no API key.
 */
const sendEmail = vi.fn<
  (options: {
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
    tags?: string[];
  }) => Promise<string | null>
>();

vi.mock("@/lib/mailgun", () => ({ sendEmail: (opts: never) => sendEmail(opts) }));

import { sendPortalUnlockedEmail } from "./portal-unlock-email";

const APP_URL = "https://app.example.com";

beforeEach(() => {
  sendEmail.mockReset();
  sendEmail.mockResolvedValue("msg-1");
});

function lastCall() {
  expect(sendEmail).toHaveBeenCalled();
  return sendEmail.mock.calls[sendEmail.mock.calls.length - 1][0];
}

describe("sendPortalUnlockedEmail", () => {
  it("sends to the recipient with the portal-ready subject", async () => {
    const result = await sendPortalUnlockedEmail({
      to: "owner@acme.test",
      firstName: "Dana",
      companyName: "Acme Co",
      appUrl: APP_URL,
    });

    expect(result).toEqual({ sent: true });
    const msg = lastCall();
    expect(msg.to).toBe("owner@acme.test");
    expect(msg.subject).toBe("Your SAM Plan AI portal is ready");
    expect(msg.tags).toContain("portal-unlocked");
  });

  it("links to the dashboard on the resolved app URL, in both HTML and text", async () => {
    await sendPortalUnlockedEmail({ to: "owner@acme.test", appUrl: APP_URL });

    const msg = lastCall();
    const link = `${APP_URL}/year-at-a-glance`;
    expect(msg.html).toContain(`href="${link}"`);
    expect(msg.text).toContain(link);
  });

  it("does not double the slash when the app URL has a trailing one", async () => {
    await sendPortalUnlockedEmail({ to: "owner@acme.test", appUrl: `${APP_URL}/` });

    expect(lastCall().text).toContain(`${APP_URL}/year-at-a-glance`);
  });

  it("greets by first name, and falls back to 'there' when absent", async () => {
    await sendPortalUnlockedEmail({ to: "a@b.test", firstName: "Dana", appUrl: APP_URL });
    expect(lastCall().text).toContain("Hi Dana,");

    await sendPortalUnlockedEmail({ to: "a@b.test", firstName: null, appUrl: APP_URL });
    expect(lastCall().text).toContain("Hi there,");
  });

  it("names the company when known and stays generic when not", async () => {
    await sendPortalUnlockedEmail({ to: "a@b.test", companyName: "Acme Co", appUrl: APP_URL });
    expect(lastCall().text).toContain("Acme Co's plan");

    await sendPortalUnlockedEmail({ to: "a@b.test", companyName: null, appUrl: APP_URL });
    const msg = lastCall();
    expect(msg.text).toContain("Everything in your plan");
    expect(msg.text).not.toContain("null");
  });

  it("leaves no bracketed placeholders in either body", async () => {
    await sendPortalUnlockedEmail({ to: "a@b.test", appUrl: APP_URL });

    const msg = lastCall();
    expect(msg.html).not.toMatch(/\[[A-Za-z ]+\]/);
    expect(msg.text).not.toMatch(/\[[A-Za-z ]+\]/);
    expect(msg.html).not.toContain("undefined");
    expect(msg.text).not.toContain("undefined");
  });

  it("reports sent:false when Mailgun refuses the message", async () => {
    sendEmail.mockResolvedValue(null);

    const result = await sendPortalUnlockedEmail({ to: "a@b.test", appUrl: APP_URL });

    expect(result.sent).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("returns sent:false instead of throwing when the transport throws", async () => {
    sendEmail.mockRejectedValue(new Error("network down"));

    const result = await sendPortalUnlockedEmail({ to: "a@b.test", appUrl: APP_URL });

    expect(result.sent).toBe(false);
    expect(result.error).toContain("network down");
  });

  it("refuses an empty recipient without attempting a send", async () => {
    const result = await sendPortalUnlockedEmail({ to: "   ", appUrl: APP_URL });

    expect(result).toEqual({ sent: false, error: "missing_recipient" });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
