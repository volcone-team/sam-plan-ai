"use client";

import { LegalLink } from "@/components/legal-link";
import type { LegalUrls } from "@/lib/legal-urls";

/**
 * The two consent checkboxes, shared by the public signup and the
 * set-password screen invited people see first.
 *
 * ONE COMPONENT so the wording is identical in both places. The promotional
 * text is the client's exact TCPA disclosure; it is not ours to tidy up.
 *
 * The first box is REQUIRED (it gates the submit). The second is OPTIONAL and
 * starts unticked: consent to be marketed at cannot be a condition of service,
 * and a pre-ticked box is not consent.
 */
export function ConsentCheckboxes({
  legal,
  termsAccepted,
  onTermsChange,
  promotionalConsent,
  onPromotionalChange,
}: {
  legal: LegalUrls;
  termsAccepted: boolean;
  onTermsChange: (value: boolean) => void;
  promotionalConsent: boolean;
  onPromotionalChange: (value: boolean) => void;
}) {
  return (
    <>
      <label
        htmlFor="termsAccepted"
        className="flex cursor-pointer items-start gap-2.5 text-xs text-[hsl(var(--foreground-muted))]"
      >
        <input
          id="termsAccepted"
          name="termsAccepted"
          type="checkbox"
          required
          checked={termsAccepted}
          onChange={(e) => onTermsChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-[hsl(var(--primary))]"
        />
        <span>
          By checking this box, I agree to the{" "}
          <LegalLink href={legal.privacyPolicyUrl}>Privacy Policy</LegalLink>{" "}
          and <LegalLink href={legal.termsUrl}>Terms &amp; Conditions</LegalLink>.
        </span>
      </label>

      <label
        htmlFor="promotionalConsent"
        className="flex cursor-pointer items-start gap-2.5 text-xs text-[hsl(var(--foreground-muted))]"
      >
        <input
          id="promotionalConsent"
          name="promotionalConsent"
          type="checkbox"
          checked={promotionalConsent}
          onChange={(e) => onPromotionalChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-[hsl(var(--primary))]"
        />
        <span>
          By checking this box, I agree to receive promotional messages
          from Advance Your Reach LLC via sms, email, phone and/or text
          using an automatic telephone dialing system or prerecorded voice
          message. Message frequency varies. Message and data rates may
          apply. Text HELP for more info or email is at{" "}
          <a
            href="mailto:info@advanceyourreach.com"
            className="text-[hsl(var(--primary))] hover:underline"
          >
            info@advanceyourreach.com
          </a>
          . Text STOP to unsubscribe from messages.
        </span>
      </label>
    </>
  );
}
