"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Search,
  Loader2,
  Users,
  Trash2,
  Gift,
  PauseCircle,
  PhoneCall,
  PlayCircle,
  Unlock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DateInput } from "@/components/ui/date-input";
import { formatMoneyFromMinor } from "@/lib/format-money";

/** The subscription half of a row. Null when the company has no subscription. */
interface CompanySubscription {
  subscriptionId: string;
  planId: string | null;
  planName: string;
  /** Plan still exists and still bills, but is no longer sold. */
  planRetired: boolean;
  billingCycle: string;
  price: number | null;
  status: string;
  stripeStatus: string | null;
  stripeMode: string | null;
  hasStripeSubscription: boolean;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pendingPlanName: string | null;
  isComped: boolean;
  compedUntil: string | null;
  compedReason: string | null;
  trialEndsAt: string | null;
  pastDueSince: string | null;
  isPaying: boolean;
  /** Admin-applied suspension. Outranks comps and trials. */
  isPaused: boolean;
  pausedAt: string | null;
  /** Internal admin note. Shown here, never to the customer. */
  pauseReason: string | null;
  pauseResumesAt: string | null;
  access: {
    allowed: boolean;
    reason: string;
    warn: boolean;
    daysRemaining: number | null;
  };
}

/**
 * Why this company last cancelled. Null if they never have.
 *
 * NOT PART OF `CompanySubscription`, because it outlives one: a customer who
 * resubscribes gets a new subscription, and a company whose subscription row
 * is gone still has a reason worth reading. It also survives reactivation —
 * changing your mind does not unmake the cancellation — which is why every
 * rendering of it carries the date.
 */
interface CompanyCancellation {
  /** Stored reason code, e.g. `too_expensive`. */
  reason: string;
  /** The label the customer themselves picked, verbatim. */
  reasonLabel: string;
  /** Their "Anything else?" free text, or null if they wrote none. */
  detail: string | null;
  cancelledAt: string;
  accessEndsAt: string | null;
}

/**
 * The onboarding call gate for one company (migration 043).
 *
 * NOT PART OF `CompanySubscription`, because it is not billing: a company can
 * be waiting for its call while fully paid, or unlocked while past due. The
 * two gates are evaluated independently and are shown independently.
 *
 * `not_gated` is the state of every company that existed before the feature,
 * which is to say almost all of them — the UI renders nothing for it rather
 * than adding a column of dashes.
 */
interface CompanyPortalAccess {
  state: "not_gated" | "waiting" | "open";
  grantedAt: string | null;
  /** The admin who opened it, by name or email. Null if unknown or never granted. */
  grantedBy: string | null;
}

interface AdminCompany {
  id: string;
  name: string;
  description: string;
  ownerEmail: string | null;
  ownerName: string | null;
  memberCount: number;
  targetRevenue: number;
  baselineRevenue: number;
  stretchRevenue: number;
  operatingBudget: number;
  currency: string;
  planStatus: string;
  planYear: number | null;
  createdAt: string;
  /** Minor units, as stored by Stripe. */
  lifetimePaid: number;
  subscription: CompanySubscription | null;
  cancellation: CompanyCancellation | null;
  portalAccess: CompanyPortalAccess;
}

function formatCurrency(amount: number, currency: string = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function getPlanStatusClasses(status: string): string {
  switch (status) {
    case "active":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    case "draft":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
    case "none":
      return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
    default:
      return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
  }
}

/** Minor units to a display string. Stripe stores cents. */
function money(minor: number | null | undefined, currency = "usd"): string {
  return formatMoneyFromMinor(minor, currency);
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("en-US", { dateStyle: "medium" })
    : "—";
}

/** One labelled fact in the expanded detail panel. */
function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
        {label}
      </p>
      <p className="mt-0.5 break-words text-sm text-[hsl(var(--foreground))]">{children}</p>
    </div>
  );
}

/**
 * Subscription state, coloured by whether the customer can actually use the
 * product — not by the raw Stripe string. Red means locked out, amber means
 * about to be, green means fine.
 */
function SubscriptionPill({ sub }: { sub: CompanySubscription | null }) {
  if (!sub) {
    return (
      <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
        No subscription
      </span>
    );
  }

  // Paused is checked FIRST because it outranks everything else: a paused
  // comped account is paused, and labelling it "Comped" would be a lie.
  const label = sub.isPaused
    ? "Paused"
    : sub.isComped
      ? "Comped"
      : sub.access.reason === "billing_disabled"
        ? "Billing off"
        : (sub.stripeStatus ?? sub.status);

  const tone = !sub.access.allowed
    ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
    : sub.access.warn
      ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
      : "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300";

  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", tone)}>
      {label}
    </span>
  );
}

/**
 * The onboarding call gate, in the State column beside the subscription pill.
 *
 * RENDERS NOTHING FOR `not_gated`, which is the majority of rows: a pill
 * saying "not applicable" on every company would bury the handful that are
 * actually waiting, and those are the only ones an admin has to act on.
 *
 * Amber for waiting, matching the "something needs you" tone the pause warning
 * and the cancelling note already use. Open is deliberately quiet — it is the
 * normal end state, not news.
 */
function PortalAccessPill({ access }: { access: CompanyPortalAccess | undefined }) {
  if (!access || access.state === "not_gated") return null;

  if (access.state === "waiting") {
    return (
      <span
        className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300"
        title="This customer has paid and is on the thank-you page. Open their portal once the onboarding call has happened."
      >
        <PhoneCall className="h-3 w-3" />
        Waiting for call
      </span>
    );
  }

  return (
    <span
      className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-[hsl(var(--background-muted))] px-2 py-0.5 text-xs font-medium text-[hsl(var(--foreground-muted))]"
      title={
        access.grantedAt
          ? `Portal opened ${shortDate(access.grantedAt)}${access.grantedBy ? ` by ${access.grantedBy}` : ""}`
          : "Portal open"
      }
    >
      <Unlock className="h-3 w-3" />
      Portal open
    </span>
  );
}

/** Rows per page. Server-enforced too: the endpoint caps limit at 100. */
const PAGE_SIZE = 20;

export function CompanyManagement() {
  const router = useRouter();
  const [companies, setCompanies] = useState<AdminCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);
  const [addWarning, setAddWarning] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({ companyName: "", ownerEmail: "", ownerFirstName: "", ownerLastName: "" });
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /**
   * Which row's detail panel is open.
   *
   * One at a time, not a set: with several expanded the table becomes a long
   * scroll of panels and the point of a compact list is lost. Opening another
   * closes the first.
   */
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /* ---- Access grants, moved here from Subscriptions ---- */

  /** Plan catalogue, for choosing which plan a comp grants. */
  const [plans, setPlans] = useState<{ id: string; name: string }[]>([]);
  const [compTarget, setCompTarget] = useState<AdminCompany | null>(null);
  const [compPlanId, setCompPlanId] = useState("");
  const [compUntil, setCompUntil] = useState("");
  const [compReason, setCompReason] = useState("");
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);

  /**
   * Grant or revoke complimentary access.
   *
   * Posts to /api/admin/subscribers, which is unchanged — it already refuses to
   * comp an account with a live paid subscription, and that refusal is the
   * authority here. Moving the BUTTON does not move the rule.
   */
  async function runAccessAction(payload: Record<string, unknown>) {
    setAccessBusy(true);
    setAccessError(null);
    try {
      const res = await fetch("/api/admin/subscribers", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAccessError(body?.message || body?.error || "That did not work.");
        return false;
      }
      // Reload the current page so the pill and actions reflect the change
      // without losing the admin's search or position.
      await loadCompanies(search, page);
      return true;
    } catch {
      setAccessError("Could not reach the server.");
      return false;
    } finally {
      setAccessBusy(false);
    }
  }

  const grantAccess = async () => {
    if (!compTarget || !compPlanId) return;
    const ok = await runAccessAction({
      action: "comp",
      companyId: compTarget.id,
      planId: compPlanId,
      until: compUntil || null,
      reason: compReason || undefined,
    });
    if (ok) {
      setCompTarget(null);
      setCompUntil("");
      setCompReason("");
    }
  };

  const revokeAccess = (company: AdminCompany) =>
    runAccessAction({ action: "uncomp", companyId: company.id });

  /* ---- Pause billing ---- */

  const [pauseTarget, setPauseTarget] = useState<AdminCompany | null>(null);
  const [pauseReason, setPauseReason] = useState("");
  const [pauseResumesAt, setPauseResumesAt] = useState("");
  /** Set when Stripe could not be updated, so the admin is told billing may still run. */
  const [pauseWarning, setPauseWarning] = useState<string | null>(null);

  /**
   * Pause or resume. Separate endpoint from comping because it does something
   * different: it tells Stripe to stop collecting and locks the customer out,
   * rather than granting a plan.
   */
  async function runPauseAction(payload: Record<string, unknown>) {
    setAccessBusy(true);
    setAccessError(null);
    setPauseWarning(null);
    try {
      const res = await fetch("/api/admin/subscribers/pause", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAccessError(body?.message || body?.error || "That did not work.");
        return false;
      }
      /**
       * The local flag always lands, so access is gated either way — but if
       * Stripe was not reached, invoicing has NOT stopped. Say so rather than
       * letting the admin assume billing is paused when it is still running.
       */
      if (body?.hasStripeSubscription && !body?.stripeSynced) {
        setPauseWarning(
          "Access is blocked, but Stripe could not be updated — invoices may still be issued. " +
            "Check the subscription in Stripe."
        );
      }
      await loadCompanies(search, page);
      return true;
    } catch {
      setAccessError("Could not reach the server.");
      return false;
    } finally {
      setAccessBusy(false);
    }
  }

  const pauseBilling = async () => {
    if (!pauseTarget) return;
    const ok = await runPauseAction({
      action: "pause",
      companyId: pauseTarget.id,
      reason: pauseReason || undefined,
      resumesAt: pauseResumesAt || null,
    });
    if (ok) {
      setPauseTarget(null);
      setPauseReason("");
      setPauseResumesAt("");
    }
  };

  const resumeBilling = (company: AdminCompany) =>
    runPauseAction({ action: "resume", companyId: company.id });

  /* ---- Portal access: the onboarding call gate (migration 043) ---- */

  /** False → migration 043 is missing, so no control is rendered at all. */
  const [callGateAvailable, setCallGateAvailable] = useState(true);
  /** Set when the grant landed but the customer was not told. */
  const [portalWarning, setPortalWarning] = useState<string | null>(null);
  /** Set when a grant or revoke changed nothing or succeeded, for one line of feedback. */
  const [portalNotice, setPortalNotice] = useState<string | null>(null);

  /**
   * Open or re-close one company's portal.
   *
   * SEPARATE FROM BOTH comping and pausing, because it answers a different
   * question — "has anyone spoken to them yet", not "have they paid" — and the
   * server keeps the two in different columns for exactly that reason.
   */
  async function runPortalAccessAction(company: AdminCompany, action: "grant" | "revoke") {
    setAccessBusy(true);
    setAccessError(null);
    setPortalWarning(null);
    setPortalNotice(null);
    try {
      const res = await fetch(`/api/admin/companies/${company.id}/portal-access`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAccessError(body?.message || body?.error || "That did not work.");
        return false;
      }

      /**
       * The grant is already committed when the email fails, so this is a
       * warning and not an error. Saying nothing would leave a paid account
       * sitting idle waiting for a message that never arrived.
       */
      if (body?.outcome === "granted" && body?.email && !body.email.sent) {
        setPortalWarning(
          `${company.name}'s portal is open, but the “your portal is ready” email could not be sent` +
            (body.email.error === "no_owner_email"
              ? " — there is no owner email on this company. Tell them another way."
              : ". Let them know another way.")
        );
      } else if (body?.outcome === "already_granted") {
        setPortalNotice(`${company.name}'s portal was already open. Nothing was changed or re-sent.`);
      } else if (body?.outcome === "already_waiting") {
        setPortalNotice(`${company.name} was already waiting for its call.`);
      } else if (body?.outcome === "granted") {
        setPortalNotice(`${company.name}'s portal is open and the owner has been emailed.`);
      } else if (body?.outcome === "revoked") {
        setPortalNotice(`${company.name} is waiting for its call again. The customer was not emailed.`);
      }

      await loadCompanies(search, page);
      return true;
    } catch {
      setAccessError("Could not reach the server.");
      return false;
    } finally {
      setAccessBusy(false);
    }
  }

  async function handleDeleteCompany(id: string) {
    setDeletingId(id);
    console.log("[CompanyManagement] Deleting company:", id);
    try {
      const res = await fetch(`/api/admin/companies/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to delete company");
        return;
      }
      console.log("[CompanyManagement] Deleted company:", id);
      setCompanies(prev => prev.filter(c => c.id !== id));
      setDeleteConfirmId(null);
    } catch (err) {
      alert("Network error deleting company");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleAddCompany(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAddSuccess(null);
    setAddWarning(null);
    setAddLoading(true);
    try {
      const res = await fetch("/api/admin/companies/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      const data = await res.json();
      if (!res.ok) { setAddError(data.error || "Failed"); return; }
      if (data.invited) {
        setAddSuccess(`${data.company.name} was created — an invite email was sent to ${data.user.email}.`);
      } else {
        setAddWarning(`${data.company.name} was created, but the invite email couldn\u2019t be sent. You can resend it from the customer\u2019s team settings.`);
      }
      setAddForm({ companyName: "", ownerEmail: "", ownerFirstName: "", ownerLastName: "" });
      loadCompanies(search);
    } catch (err) {
      setAddError("Network error");
    } finally {
      setAddLoading(false);
    }
  }

  /**
   * Loads ONE PAGE from the server. The endpoint already accepted search, limit
   * and offset; the UI simply asked for a flat 50 and ignored paging, so beyond
   * 50 companies the rest were unreachable.
   */
  async function loadCompanies(searchTerm: string = "", pageIndex: number = 0) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.set("search", searchTerm);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(pageIndex * PAGE_SIZE));

      const res = await fetch(`/api/admin/companies?${params}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to load companies");
        console.error("[CompanyManagement] API error:", data.error);
        return;
      }

      setCompanies(data.companies || []);
      setTotal(data.total || 0);
      setPlans(data.plans || []);
      // Defaults to true for an older response that does not say, which only
      // ever means the control renders and the route's own 409 explains why.
      setCallGateAvailable(data.callGateAvailable !== false);
    } catch (err: any) {
      setError(err?.message || "Network error");
      console.error("[CompanyManagement] Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }

  // Search and page changes share one effect, so they cannot race each other into
  // a mismatched request. Editing the search resets to page 0 below, because page
  // 3 of the previous results says nothing about the new filter.
  useEffect(() => {
    const timeout = setTimeout(() => {
      loadCompanies(search, page);
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, page]);

  if (loading && companies.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
        <span className="ml-2 text-sm text-[hsl(var(--foreground-muted))]">Loading companies…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/30">
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        <button
          onClick={() => loadCompanies(search)}
          className="mt-3 text-sm font-medium text-red-600 hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Add Company button */}
      <div className="flex items-center justify-end mb-4">
        <button onClick={() => setShowAddForm(!showAddForm)} className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-white hover:opacity-90">+ Add Company</button>
      </div>

      {showAddForm && (
        <div className="mb-6 rounded-[var(--radius-lg)] border border-border bg-card p-5">
          <h4 className="text-sm font-semibold mb-4">Create New Company + Owner</h4>
          {addError && <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{addError}</div>}
          {addSuccess && <div className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{addSuccess}</div>}
          {addWarning && <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">{addWarning}</div>}
          <form onSubmit={handleAddCompany} className="space-y-3">
            <div><label className="mb-1 block text-xs font-medium">Company Name *</label><input type="text" required value={addForm.companyName} onChange={(e) => setAddForm(f => ({ ...f, companyName: e.target.value }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" placeholder="Acme Coaching" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1 block text-xs font-medium">First Name *</label><input type="text" required value={addForm.ownerFirstName} onChange={(e) => setAddForm(f => ({ ...f, ownerFirstName: e.target.value }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" /></div>
              <div><label className="mb-1 block text-xs font-medium">Last Name</label><input type="text" value={addForm.ownerLastName} onChange={(e) => setAddForm(f => ({ ...f, ownerLastName: e.target.value }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" /></div>
            </div>
            <div><label className="mb-1 block text-xs font-medium">Owner Email *</label><input type="email" required value={addForm.ownerEmail} onChange={(e) => setAddForm(f => ({ ...f, ownerEmail: e.target.value }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" placeholder="owner@company.com" /></div>
            <p className="text-xs text-[hsl(var(--foreground-muted))]">The owner will receive an invite email with a link to set their own password.</p>
            <div className="flex gap-2 pt-2">
              <button type="submit" disabled={addLoading} className="rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">{addLoading ? "Creating..." : "Create Company"}</button>
              <button type="button" onClick={() => setShowAddForm(false)} className="rounded-md border border-border px-4 py-2 text-sm font-medium">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--foreground-muted))]" />
          <input
            type="text"
            placeholder="Search companies…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="w-full rounded-[var(--radius-md)] border border-border bg-card pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
          />
        </div>
        <span className="text-sm text-[hsl(var(--foreground-muted))]">
          {total} {total === 1 ? "company" : "companies"}
        </span>
      </div>

      {/* Companies Table */}
      {companies.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-border bg-card p-12 text-center">
          <Building2 className="h-10 w-10 text-[hsl(var(--foreground-muted))]" />
          <h3 className="mt-3 text-base font-semibold">No companies found</h3>
          <p className="mt-1.5 text-sm text-[hsl(var(--foreground-muted))]">
            {search ? "No companies match your search." : "No customers have signed up yet."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-[hsl(var(--background-muted))]">
                <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">
                  Company
                </th>
                <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">
                  Owner
                </th>
                <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">
                  Subscription
                </th>
                <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">
                  State
                </th>
                {/* Accordion toggle. No header text — the control labels itself. */}
                <th className="w-10 px-2 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {companies.map((company) => {
                const open = expandedId === company.id;
                const sub = company.subscription;

                return (
                  <Fragment key={company.id}>
                    <tr
                      className={cn(
                        "transition-colors",
                        open
                          ? "bg-[hsl(var(--background-muted))]"
                          : "hover:bg-[hsl(var(--background))]"
                      )}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                            <Building2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                          </div>
                          <div className="min-w-0">
                            <span className="font-medium text-[hsl(var(--foreground))]">
                              {company.name}
                            </span>
                            <p className="text-xs text-[hsl(var(--foreground-muted))]">
                              <span className="inline-flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {company.memberCount}
                              </span>
                              {" · joined "}
                              {new Date(company.createdAt).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <p className="text-[hsl(var(--foreground))]">
                          {company.ownerName || "—"}
                        </p>
                        <p className="truncate text-xs text-[hsl(var(--foreground-muted))]">
                          {company.ownerEmail || ""}
                        </p>
                      </td>

                      <td className="px-4 py-3">
                        {sub ? (
                          <>
                            <span className="text-[hsl(var(--foreground))]">
                              {sub.planName}
                            </span>
                            {/*
                              Flagged because it is not visible anywhere else:
                              the account bills and is entitled as normal, but
                              the plan is gone from the pricing cards, so an
                              admin reading just the name would not know.
                            */}
                            {sub.planRetired && (
                              <span
                                className="ml-1.5 inline-flex rounded-full bg-[hsl(var(--background-muted))] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--foreground-muted))]"
                                title="No longer sold to new customers. Billing and limits unchanged."
                              >
                                Retired
                              </span>
                            )}
                            <p className="text-xs text-[hsl(var(--foreground-muted))]">
                              {sub.billingCycle}
                              {company.lifetimePaid > 0 && ` · ${money(company.lifetimePaid)} paid`}
                            </p>
                          </>
                        ) : (
                          <span className="text-[hsl(var(--foreground-muted))]">—</span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <SubscriptionPill sub={sub} />
                        {sub?.cancelAtPeriodEnd && (
                          <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                            Cancelling
                          </p>
                        )}
                        {sub?.pendingPlanName && (
                          <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                            → {sub.pendingPlanName}
                          </p>
                        )}
                        {/*
                          In the collapsed row, not only the accordion: "who is
                          waiting for their call" is a list an admin scans, and
                          a state you have to open twenty panels to find is a
                          state nobody acts on.
                        */}
                        {callGateAvailable && (
                          <PortalAccessPill access={company.portalAccess} />
                        )}
                      </td>

                      {/*
                        One toggle per row rather than a row-wide click target:
                        the row contains its own links and buttons, and making
                        the whole thing clickable would fight them.
                      */}
                      <td className="px-2 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setExpandedId(open ? null : company.id)}
                          aria-expanded={open}
                          aria-controls={`company-detail-${company.id}`}
                          aria-label={`${open ? "Hide" : "Show"} details for ${company.name}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-[hsl(var(--foreground-muted))] transition-colors hover:bg-[hsl(var(--background))] hover:text-[hsl(var(--foreground))]"
                        >
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 transition-transform",
                              open && "rotate-180"
                            )}
                          />
                        </button>
                      </td>
                    </tr>

                    {/*
                      The detail row. Everything that used to be its own column
                      lives here: eleven columns never fit, so the table showed
                      four of them crushed and the rest cut off.
                    */}
                    {open && (
                      <tr id={`company-detail-${company.id}`}>
                        <td
                          colSpan={5}
                          className="border-t border-border bg-[hsl(var(--background-muted))] px-4 py-4"
                        >
                          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                            <Detail label="Renews / ends">
                              {!sub
                                ? "—"
                                : sub.isComped
                                  ? sub.compedUntil
                                    ? `Comp ends ${shortDate(sub.compedUntil)}`
                                    : "No expiry"
                                  : sub.cancelAtPeriodEnd
                                    ? `Ends ${shortDate(sub.currentPeriodEnd)}`
                                    : shortDate(sub.currentPeriodEnd)}
                            </Detail>

                            <Detail label="Lifetime paid">
                              {money(company.lifetimePaid)}
                            </Detail>

                            <Detail label="Target revenue">
                              {company.targetRevenue > 0
                                ? formatCurrency(company.targetRevenue, company.currency)
                                : "—"}
                            </Detail>

                            <Detail label="Plan status">
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
                                  getPlanStatusClasses(company.planStatus)
                                )}
                              >
                                {company.planStatus}
                                {company.planYear ? ` · ${company.planYear}` : ""}
                              </span>
                            </Detail>

                            <Detail label="Baseline / stretch">
                              {company.baselineRevenue > 0 || company.stretchRevenue > 0
                                ? `${formatCurrency(company.baselineRevenue, company.currency)} / ${formatCurrency(company.stretchRevenue, company.currency)}`
                                : "—"}
                            </Detail>

                            <Detail label="Members">{company.memberCount}</Detail>

                            {sub?.stripeMode && (
                              <Detail label="Stripe mode">{sub.stripeMode}</Detail>
                            )}

                            {sub?.compedReason && (
                              <Detail label="Comp reason">{sub.compedReason}</Detail>
                            )}

                            {sub?.isPaused && (
                              <>
                                <Detail label="Paused since">
                                  {shortDate(sub.pausedAt)}
                                </Detail>
                                <Detail label="Auto-resumes">
                                  {sub.pauseResumesAt
                                    ? shortDate(sub.pauseResumesAt)
                                    : "Not set — resume manually"}
                                </Detail>
                                {sub.pauseReason && (
                                  <Detail label="Pause reason">{sub.pauseReason}</Detail>
                                )}
                              </>
                            )}

                            {/*
                              Shown only for a company the gate applies to, and
                              only once 043 is applied. The granted pair is the
                              audit trail — "who let them in, and when" — which
                              exists nowhere else in the UI.
                            */}
                            {callGateAvailable &&
                              company.portalAccess &&
                              company.portalAccess.state !== "not_gated" && (
                                <Detail label="Portal access">
                                  {company.portalAccess.state === "waiting" ? (
                                    <span className="text-amber-700 dark:text-amber-400">
                                      Waiting for the onboarding call
                                    </span>
                                  ) : (
                                    <>
                                      Opened {shortDate(company.portalAccess.grantedAt)}
                                      {company.portalAccess.grantedBy
                                        ? ` by ${company.portalAccess.grantedBy}`
                                        : ""}
                                    </>
                                  )}
                                </Detail>
                              )}

                            {company.description && (
                              <div className="sm:col-span-2 lg:col-span-4">
                                <Detail label="Description">{company.description}</Detail>
                              </div>
                            )}

                            {/*
                              WHY THEY LEFT.
                              Full width, like Description, because the second
                              line is the customer's own prose and would wrap
                              to shreds in a quarter-width column.

                              ALWAYS SHOWN once a cancellation exists, never
                              gated on the current subscription state. Someone
                              who cancelled and came back is exactly the
                              account an operator most wants the history on,
                              and that is also the case where the subscription
                              looks perfectly healthy. The date is part of the
                              note for that reason — it reads as history, not
                              as a claim about today.
                            */}
                            {company.cancellation && (
                              <div className="sm:col-span-2 lg:col-span-4">
                                <Detail label="Reason for plan cancellation">
                                  <span className="font-medium">
                                    {company.cancellation.reasonLabel}
                                  </span>
                                  <span className="text-[hsl(var(--foreground-muted))]">
                                    {" — cancelled "}
                                    {shortDate(company.cancellation.cancelledAt)}
                                    {company.cancellation.accessEndsAt
                                      ? `, access ended ${shortDate(company.cancellation.accessEndsAt)}`
                                      : ""}
                                  </span>
                                  {company.cancellation.detail && (
                                    /*
                                      Quoted and italicised so it is obvious
                                      this is the customer talking, not us. It
                                      is unfiltered free text, which is why it
                                      stays inside the accordion and never
                                      reaches a collapsed row.
                                    */
                                    <span className="mt-1 block italic text-[hsl(var(--foreground-muted))]">
                                      “{company.cancellation.detail}”
                                    </span>
                                  )}
                                </Detail>
                              </div>
                            )}
                          </div>

                          {/* Actions, grouped at the end of the detail panel. */}
                          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                            <button
                              onClick={() => router.push(`/admin/companies/${company.id}`)}
                              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--background))]"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              View details
                            </button>

                            {/*
                              Portal access, first among the access actions
                              because it is the one with a customer sitting on
                              the other side of it.

                              NOT OFFERED for a company the gate never applied
                              to, and not offered at all before 043: a button
                              that cannot store its result is worse than none,
                              since the admin would believe a customer had been
                              let in. The server refuses both cases too.
                            */}
                            {callGateAvailable &&
                              company.portalAccess?.state === "waiting" && (
                                <button
                                  onClick={() => runPortalAccessAction(company, "grant")}
                                  disabled={accessBusy}
                                  className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-40 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/30"
                                >
                                  <Unlock className="h-3.5 w-3.5" />
                                  Open portal
                                </button>
                              )}

                            {callGateAvailable &&
                              company.portalAccess?.state === "open" && (
                                <button
                                  onClick={() => runPortalAccessAction(company, "revoke")}
                                  disabled={accessBusy}
                                  title="Puts this company back on the thank-you page until you open it again. The customer is not emailed."
                                  className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-[hsl(var(--foreground-muted))] transition-colors hover:bg-[hsl(var(--background))] disabled:opacity-40"
                                >
                                  <PhoneCall className="h-3.5 w-3.5" />
                                  Close portal again
                                </button>
                              )}

                            {/*
                              Grant is offered ONLY to accounts that are not
                              paying. Comping a live subscriber would hand them
                              a free plan while Stripe keeps charging their
                              card, and would corrupt the flag that answers
                              "who is not paying". The server refuses it too.
                            */}
                            {/*
                              Pause / resume, offered for any account with a
                              subscription — including comped ones and trials,
                              which have no Stripe subscription but must still
                              be lockable.
                            */}
                            {sub && (
                              sub.isPaused ? (
                                <button
                                  onClick={() => resumeBilling(company)}
                                  disabled={accessBusy}
                                  className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-[hsl(var(--primary))] transition-colors hover:bg-[hsl(var(--background))] disabled:opacity-40"
                                >
                                  <PlayCircle className="h-3.5 w-3.5" />
                                  Resume billing
                                </button>
                              ) : (
                                <button
                                  onClick={() => {
                                    setPauseTarget(company);
                                    setPauseReason("");
                                    setPauseResumesAt("");
                                    setAccessError(null);
                                    setPauseWarning(null);
                                  }}
                                  disabled={accessBusy}
                                  className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-2.5 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-50 disabled:opacity-40 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-900/20"
                                >
                                  <PauseCircle className="h-3.5 w-3.5" />
                                  Pause billing
                                </button>
                              )
                            )}

                            {sub?.isComped ? (
                              <button
                                onClick={() => revokeAccess(company)}
                                disabled={accessBusy}
                                className="rounded-md border border-red-300 px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:hover:bg-red-900/20"
                              >
                                Revoke access
                              </button>
                            ) : sub?.isPaying ? (
                              <span className="text-xs text-[hsl(var(--foreground-muted))]">
                                Paying customer — cancel in Stripe before granting a comp
                              </span>
                            ) : sub ? (
                              <button
                                onClick={() => {
                                  setCompTarget(company);
                                  setCompPlanId(sub.planId ?? plans[0]?.id ?? "");
                                  setAccessError(null);
                                }}
                                disabled={accessBusy}
                                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-[hsl(var(--primary))] transition-colors hover:bg-[hsl(var(--background))] disabled:opacity-40"
                              >
                                <Gift className="h-3.5 w-3.5" />
                                Grant access
                              </button>
                            ) : null}

                            {/* Delete sits last and apart, being irreversible. */}
                            <div className="ml-auto">
                              {deleteConfirmId === company.id ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => handleDeleteCompany(company.id)}
                                    disabled={deletingId === company.id}
                                    className="rounded-md bg-red-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                                  >
                                    {deletingId === company.id
                                      ? "Deleting..."
                                      : "Confirm delete"}
                                  </button>
                                  <button
                                    onClick={() => setDeleteConfirmId(null)}
                                    className="rounded-md border border-border px-2 py-1.5 text-xs font-medium text-[hsl(var(--foreground-muted))]"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setDeleteConfirmId(company.id)}
                                  className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Delete company
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>


          {/*
            Server-side pager. Shown only when there is more than one page, so a
            small deployment is not cluttered by controls that do nothing.
          */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-[hsl(var(--foreground-muted))]">
              <span>
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0 || loading}
                  aria-label="Previous page"
                  className="rounded-[var(--radius-md)] border border-border p-1.5 hover:bg-[hsl(var(--background-muted))] disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-1">
                  {page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setPage((p) => Math.min(Math.ceil(total / PAGE_SIZE) - 1, p + 1))
                  }
                  disabled={(page + 1) * PAGE_SIZE >= total || loading}
                  aria-label="Next page"
                  className="rounded-[var(--radius-md)] border border-border p-1.5 hover:bg-[hsl(var(--background-muted))] disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Grant access dialog, moved from the Subscriptions page. */}
      {compTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-label="Grant access"
            className="w-full max-w-md rounded-[var(--radius-lg)] border border-border bg-card p-6"
          >
            <h3 className="text-base font-semibold">
              Grant free access — {compTarget.name || "this account"}
            </h3>
            <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
              Full use of the chosen plan with no payment. Plan limits still apply, and
              Stripe is not involved at all.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="comp-plan" className="block text-xs font-medium">
                  Plan
                </label>
                <select
                  id="comp-plan"
                  value={compPlanId}
                  onChange={(e) => setCompPlanId(e.target.value)}
                  className="mt-1 w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm"
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="comp-until" className="block text-xs font-medium">
                  Until (blank = no expiry)
                </label>
                {/*
                  MM/DD/YYYY regardless of the admin's OS locale. A native date
                  input renders in the browser's locale, so this read
                  `dd-mm-yyyy` while every date the app prints is month-first —
                  ambiguous on a value that controls when free access ends.
                */}
                <DateInput
                  id="comp-until"
                  value={compUntil}
                  onValueChange={setCompUntil}
                  className="mt-1"
                />
              </div>
              <div>
                <label htmlFor="comp-reason" className="block text-xs font-medium">
                  Reason
                </label>
                <input
                  id="comp-reason"
                  type="text"
                  value={compReason}
                  placeholder="Partner account, beta tester, etc."
                  onChange={(e) => setCompReason(e.target.value)}
                  className="mt-1 w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>

            {accessError && (
              <p role="alert" className="mt-3 text-xs text-[hsl(var(--destructive))]">
                {accessError}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setCompTarget(null)}
                className="rounded-[var(--radius-md)] border border-border px-3 py-2 text-sm hover:bg-[hsl(var(--background-muted))]"
              >
                Cancel
              </button>
              <button
                disabled={accessBusy || !compPlanId}
                onClick={grantAccess}
                className="rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Grant access
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pause dialog */}
      {pauseTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-label="Pause billing"
            className="w-full max-w-md rounded-[var(--radius-lg)] border border-border bg-card p-6"
          >
            <h3 className="text-base font-semibold">
              Pause billing — {pauseTarget.name || "this account"}
            </h3>
            <p className="mt-2 text-xs text-[hsl(var(--foreground-muted))]">
              Invoicing stops and the customer is locked out of every page until
              you resume. The subscription is NOT cancelled and nothing is
              deleted — resuming restores access exactly as it was.
            </p>
            <p className="mt-2 text-xs text-[hsl(var(--foreground-muted))]">
              They will see a page saying their plan is paused, with the contact
              email from AI Tools. Your reason below is for your records and is
              never shown to them.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="pause-resumes" className="block text-xs font-medium">
                  Resume automatically on (blank = until you resume it)
                </label>
                <DateInput
                  id="pause-resumes"
                  value={pauseResumesAt}
                  onValueChange={setPauseResumesAt}
                  className="mt-1"
                />
              </div>
              <div>
                <label htmlFor="pause-reason" className="block text-xs font-medium">
                  Reason (internal)
                </label>
                <input
                  id="pause-reason"
                  type="text"
                  value={pauseReason}
                  placeholder="Non-payment, contract on hold, etc."
                  onChange={(e) => setPauseReason(e.target.value)}
                  className="mt-1 w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>

            {accessError && (
              <p role="alert" className="mt-3 text-xs text-[hsl(var(--destructive))]">
                {accessError}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setPauseTarget(null)}
                className="rounded-[var(--radius-md)] border border-border px-3 py-2 text-sm hover:bg-[hsl(var(--background-muted))]"
              >
                Cancel
              </button>
              <button
                disabled={accessBusy}
                onClick={pauseBilling}
                className="rounded-[var(--radius-md)] bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-40"
              >
                Pause billing
              </button>
            </div>
          </div>
        </div>
      )}

      {/*
        Stripe did not sync. Access IS blocked, but invoices may still be
        issued, which the admin needs to know rather than assume.
      */}
      {pauseWarning && (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          {pauseWarning}
        </p>
      )}

      {/*
        The portal opened but the customer was not told. Amber, not red: the
        grant stands, so this is a "go and message them" rather than a failure
        to retry — clicking again would not re-send anyway.
      */}
      {portalWarning && (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          {portalWarning}
        </p>
      )}

      {portalNotice && !portalWarning && (
        <p
          role="status"
          className="rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] px-3 py-2.5 text-sm text-[hsl(var(--foreground-muted))]"
        >
          {portalNotice}
        </p>
      )}

      {/* A revoke or resume failure has no dialog of its own, so surface it here. */}
      {accessError && !compTarget && !pauseTarget && (
        <p role="alert" className="text-sm text-[hsl(var(--destructive))]">
          {accessError}
        </p>
      )}
    </div>
  );
}
