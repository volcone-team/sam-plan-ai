/**
 * Sample (demo) plan data for the public /sample-plan page.
 *
 * This page is a marketing demo and is MEANT to show fabricated example data.
 * It used to get that data implicitly, by calling the real services and
 * relying on them silently falling back to mock JSON when the query returned
 * nothing. That fallback has been removed (a misconfigured environment must
 * fail loudly rather than serve fake records), so the demo now sources its
 * sample data explicitly and honestly from here.
 */

import companyData from "@/mock-data/company.json";
import plansData from "@/mock-data/plans.json";
import initiativesData from "@/mock-data/initiatives.json";

export interface SampleCompany {
  id: string;
  name: string;
  planningYear: number;
  fiscalYear: number;
  currency: string;
  targetRevenue: number;
  baselineRevenue: number;
  stretchRevenue: number;
  operatingBudget: number;
}

export interface SampleQuarterlyPlan {
  id: string;
  quarter: number;
  year: number;
  targetRevenue: number;
  notes: string;
}

export interface SampleInitiative {
  id: string;
  name: string;
  description: string;
  status: string;
  revenueScenarios: { good: number; better: number; best: number };
}

export function getSampleCompany(): SampleCompany {
  return {
    id: companyData.id,
    name: companyData.name,
    planningYear: companyData.planningYear,
    fiscalYear: companyData.fiscalYear,
    currency: companyData.currency || "USD",
    targetRevenue: companyData.targetRevenue,
    baselineRevenue: companyData.baselineRevenue,
    stretchRevenue: companyData.stretchRevenue,
    operatingBudget: companyData.operatingBudget,
  };
}

export function getSampleQuarterlyPlans(year: number): SampleQuarterlyPlan[] {
  return (plansData.quarterlyPlans || [])
    .filter((qp) => qp.year === year)
    .map((qp) => ({
      id: qp.id,
      quarter: qp.quarter,
      year: qp.year,
      targetRevenue: qp.targetRevenue,
      notes: qp.notes || "",
    }));
}

export function getSampleInitiatives(): SampleInitiative[] {
  return (initiativesData as Array<Record<string, unknown>>).map((i) => {
    const scenarios = (i.revenueScenarios as { good?: number; better?: number; best?: number }) || {};
    return {
      id: String(i.id),
      name: String(i.name),
      description: String(i.description || ""),
      status: String(i.status || "planned"),
      revenueScenarios: {
        good: Number(scenarios.good) || 0,
        better: Number(scenarios.better) || 0,
        best: Number(scenarios.best) || 0,
      },
    };
  });
}
