/**
 * Applies an accepted Enhance Plan suggestion to the live plan. Used by
 * PATCH /api/plan/suggestions/[id]; kept out of the route so it can be tested.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { SupabaseClient } from "@supabase/supabase-js";
import { toDateOnly, clampNotBefore, todayDateOnly, clampDayOfMonth } from "@/lib/plan-dates";
import { loadLibrary } from "@/lib/workbook/read";
import { resolveTaskTemplates, runwayForUntemplated } from "@/lib/workbook/tasks-for-initiatives";
import { insertWithLibraryKey, supabaseTypeStore } from "@/lib/workbook/initiative-type";
import { resolveSuggestionInitiative, suggestionChannel } from "@/lib/initiatives/suggestion-initiative";
import { materialiseTasks, materialiseAiTasks, templateRunwayDays } from "@/lib/workbook/materialise";
import { loadCompanyFit, rejectionReason } from "@/lib/recommend/company-eligibility";
import { LIMIT_KEYS } from "@/lib/billing/limits";
import { checkLiveLimit, type LiveLimitResult } from "@/lib/billing/live-limits";

/** An accepted new_initiative whose library key fails FIT; `message` is the rule's reason. */
export class SuggestionRejected extends Error {}

/** An accepted new_initiative the plan year has no room for (max_initiatives). */
export class SuggestionOverLimit extends Error {
  readonly result: LiveLimitResult;
  constructor(result: LiveLimitResult) {
    super(result.message);
    this.result = result;
  }
}

/** Applies an accepted suggestion to the live plan. */
export async function applySuggestion(db: SupabaseClient, companyId: string, s: any): Promise<void> {
  const proposed = s.proposed_value || {};
  const type = s.suggestion_type;

  if (type === "budget_change") {
    if (!s.target_id) throw new Error("No target initiative for budget change");
    const budget = Number(proposed.plannedBudget) || 0;
    console.log("[applySuggestion] budget_change:", s.target_id, "->", budget);
    const { error } = await db.from("initiatives").update({ planned_budget: budget }).eq("id", s.target_id).eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return;
  }

  if (type === "date_change") {
    if (!s.target_id) throw new Error("No target initiative for date change");
    // AI may return a full ISO date string ("2025-01-31") or a month number (1-12).
    const raw = proposed.activationMonth;
    const today = todayDateOnly();
    let activationDate: string;
    if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
      /**
       * FLOORED AT TODAY.
       *
       * This used to take the model's date verbatim, which is how enhancing
       * the 2026 plan moved an initiative to 2025 — a date already in the
       * past, with tasks the user could never perform. `new_initiative` below
       * has always clamped; this branch did not.
       */
      activationDate = toDateOnly(clampNotBefore(raw.split("T")[0], today));
    } else {
      // Month number - build a date in the current year, never in the past.
      const month = Number(raw);
      if (!month || month < 1 || month > 12) throw new Error("Invalid activation month: " + raw);
      const year = new Date().getFullYear();
      activationDate = toDateOnly(
        clampNotBefore(new Date(year, month - 1, 1), today)
      );
    }
    console.log("[applySuggestion] date_change:", s.target_id, "->", activationDate);
    const { error } = await db.from("initiatives").update({ activation_date: activationDate }).eq("id", s.target_id).eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return;
  }

  // "target_change" (baseline/stretch goals) is retired: goals are fixed for
  // the year. It falls through to "Unknown suggestion type" below, and the
  // PATCH route refuses it before reaching here.

  if (type === "product_update") {
    if (!s.target_id) throw new Error("No target product for product update");
    const updates: Record<string, number> = {};
    if (proposed.price != null) updates.price = Number(proposed.price) || 0;
    if (Object.keys(updates).length === 0) throw new Error("No product changes to apply");
    console.log("[applySuggestion] product_update:", s.target_id, updates);
    const { error } = await db.from("products").update(updates).eq("id", s.target_id).eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return;
  }

  if (type === "new_initiative") {
    const [{ data: annualPlan }, { data: products }, library] = await Promise.all([
      db.from("annual_plans").select("id, year").eq("company_id", companyId).order("year", { ascending: false }).limit(1).single(),
      db.from("products").select("id").eq("company_id", companyId).eq("is_active", true).order("display_order").limit(1),
      // Inactive included: the suggestion was made from the library, and its
      // row still says what the initiative is and tracks.
      loadLibrary(db, { includeInactive: true }),
    ]);

    if (!annualPlan) throw new Error("No annual plan to attach the initiative to");
    const productId = products?.[0]?.id;
    if (!productId) throw new Error("No product to attach the initiative to");

    // The workbook library key IS the channel. `channel` is only a fallback for
    // suggestions generated before the library was wired in.
    const channel = suggestionChannel(proposed);

    /**
     * FIT, enforced at the point of acceptance. A suggestion can predate a
     * toggle change or an intake edit, and the model's key was only ever a
     * proposal, so the key is re-checked against this company's FIT and the
     * admin allowlist — the same rules /api/intake/recommend applies — and
     * refused with the rule's reason. Non-library channels are unaffected.
     */
    const { ctx } = await loadCompanyFit(db, companyId);
    const reason = rejectionReason(library.find((e) => e.initiativeKey === channel), ctx);
    if (reason) throw new SuggestionRejected(reason);

    // max_initiatives, live, in the plan year this initiative is filed under.
    // Checked before a type can be created or anything inserted.
    const limit = await checkLiveLimit(db, companyId, LIMIT_KEYS.MAX_INITIATIVES, 1, {
      annualPlanId: annualPlan.id as string,
      year: typeof annualPlan.year === "number" ? annualPlan.year : null,
    });
    if (!limit.ok) throw new SuggestionOverLimit(limit);

    /**
     * The shared type rule (src/lib/workbook/initiative-type.ts): the oldest
     * row with this channel, active or not, else one created once from the
     * library entry. This used to fall back to the FIRST type in the table
     * when the channel had none, attaching the initiative to an arbitrary
     * unrelated type.
     */
    const mapping = await resolveSuggestionInitiative(
      supabaseTypeStore(db, "[plan/suggestions]"),
      channel,
      library.find((e) => e.initiativeKey === channel)
    );
    const typeId = mapping.typeId;
    if (!typeId) throw new Error("Could not resolve an initiative type");

    // AI may return a full ISO date string ("2025-04-30") or a month number (1-12).
    // Tasks come from the workbook template for this library key, exactly as in
    // generation. Accepting a suggestion used to create an initiative with NO
    // tasks at all, so the plan looked generated but had no project plan behind it.
    /**
     * The shared resolver, so accepting a suggestion gets the same three-way
     * answer as a build: workbook template, else an AI-written list, else the
     * generic starter. It used to be template-or-the-suggestion's-own-tasks,
     * which left an initiative with NO tasks whenever the library key had no
     * template and the suggestion carried no usable list.
     */
    const resolved = await resolveTaskTemplates(db, [channel], {
      companyId,
      logLabel: "[applySuggestion]",
    });
    const templates = resolved.get(channel)?.templates ?? [];
    const taskSource = resolved.get(channel)?.source ?? "starter";
    // Authored lead times where they exist; the starter runway otherwise, for
    // the same reason as intake build (see the comment there).
    const runway = taskSource === "template"
      ? templateRunwayDays(templates)
      : runwayForUntemplated();

    // Dates floored at today, so accepting a suggestion never back-dates work.
    // The event was previously hardcoded to the 15th (or activation + 14 days)
    // and written via toISOString(), which shifts the calendar day.
    const today = todayDateOnly();
    const rawMonth = proposed.activationMonth;
    let eventDateObj: Date;
    if (typeof rawMonth === "string" && /^\d{4}-\d{2}-\d{2}/.test(rawMonth)) {
      eventDateObj = clampNotBefore(rawMonth.split("T")[0], today);
    } else {
      const month = Number(rawMonth) || new Date().getMonth() + 1;
      const mClamped = Math.min(Math.max(month, 1), 12);
      const year = new Date().getFullYear();
      // Mid-month only as a placeholder, when no day is supplied at all.
      const day = clampDayOfMonth(year, mClamped, 15);
      eventDateObj = clampNotBefore(new Date(year, mClamped - 1, day), today);
    }
    // The event must leave room for its own preparation.
    if (runway > 0) {
      eventDateObj = clampNotBefore(
        eventDateObj,
        new Date(today.getFullYear(), today.getMonth(), today.getDate() + runway)
      );
    }
    // Activation is when preparation starts.
    const activationDateObj = clampNotBefore(
      new Date(eventDateObj.getFullYear(), eventDateObj.getMonth(), eventDateObj.getDate() - runway),
      today
    );
    const activationDate = toDateOnly(activationDateObj);
    const eventDate = toDateOnly(eventDateObj);
    const revenueBetter = Number(proposed.revenueBetter) || 0;

    console.log("[applySuggestion] new_initiative:", proposed.name, "| channel:", channel, "| date:", activationDate);

    // `library_key` and `metric_set` (migration 040) ride along; omitted if
    // the columns are absent.
    const { data: created, error } = await insertWithLibraryKey({
      company_id: companyId,
      annual_plan_id: annualPlan.id,
      product_id: productId,
      initiative_type_id: typeId,
      name: String(proposed.name || s.title || "New Initiative"),
      description: String(proposed.description || ""),
      kind: "one-time",
      status: "planned",
      activation_date: activationDate,
      event_date: eventDate,
      revenue_good: Math.round(revenueBetter * 0.7),
      revenue_better: revenueBetter,
      revenue_best: Math.round(revenueBetter * 1.3),
      planned_budget: Number(proposed.plannedBudget) || 0,
      actual_spend: 0,
      display_order: 0,
    },
      mapping.libraryKey,
      (row) => db.from("initiatives").insert(row).select("id").single(),
      mapping.metricSet
    );
    if (error) throw new Error(error.message);

    /**
     * Attach the project plan. The resolver has already picked the best
     * available source, with one exception kept from the old behaviour: where
     * it fell all the way back to the GENERIC starter, the suggestion's own
     * task list — written for this specific initiative by the Enhance call
     * that produced the suggestion — is the better plan, so it wins.
     */
    const ownTasks = taskSource === "starter"
      ? materialiseAiTasks(proposed.tasks, { eventDate: eventDateObj, floor: today })
      : [];
    const tasks = ownTasks.length > 0
      ? ownTasks
      : materialiseTasks(templates, { eventDate: eventDateObj, floor: today });

    if (!created?.id) {
      console.error("[applySuggestion] initiative id missing - tasks not attached");
      return;
    }
    // Should no longer be reachable — the starter template always has six
    // steps — but an initiative saved without its tasks is still better than a
    // thrown error, so the guard stays.
    if (tasks.length === 0) {
      console.warn("[applySuggestion] no tasks resolved for", channel);
      return;
    }
    const { error: taskErr } = await db.from("tasks").insert(
      tasks.map((t) => ({
        id: t.id,
        initiative_id: created.id,
        company_id: companyId,
        name: t.name,
        description: t.description,
        due_date: t.dueDate,
        estimated_hours: t.estimatedHours,
        status: "not_started",
        priority: t.priority,
        display_order: t.displayOrder,
        dependency_ids: t.dependencyIds,
      }))
    );
    if (taskErr) throw new Error("Initiative saved but its tasks failed: " + taskErr.message);
    console.log("[applySuggestion] attached", tasks.length,
      ownTasks.length > 0 ? "suggestion" : taskSource, "tasks to", proposed.name);
    return;
  }

  throw new Error("Unknown suggestion type: " + type);
}
