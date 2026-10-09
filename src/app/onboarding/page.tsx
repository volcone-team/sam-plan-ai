import { redirect } from "next/navigation";

/**
 * Legacy onboarding entry point.
 *
 * The flow is account-first: Landing -> "Create an Account" -> /auth/signup
 * -> /onboarding/welcome, which is the hub that starts the intake.
 *
 * Redirected rather than deleted so old links and bookmarks keep working.
 */
export default function OnboardingIndexPage() {
  redirect("/onboarding/welcome");
}
