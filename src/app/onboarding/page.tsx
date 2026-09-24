import { redirect } from "next/navigation";

/**
 * Legacy onboarding entry point.
 *
 * The flow is now account-first: Landing -> "Create an Account" -> /auth/signup
 * -> /onboarding/welcome, which is the single hub offering Quickstart, the full
 * questionnaire, or skipping to the dashboard.
 *
 * This old path-selection screen duplicated that hub and sat outside the flow:
 * pressing Back from the questionnaire landed here, and its own back link sent
 * authenticated users straight to the dashboard, silently abandoning onboarding.
 * Redirecting keeps old links and bookmarks working.
 */
export default function OnboardingIndexPage() {
  redirect("/onboarding/welcome");
}
