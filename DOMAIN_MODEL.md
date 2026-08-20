# Domain Model Documentation
## Phase 1.1: Complete TypeScript Domain Model for SAM Flow AI

**Status**: ✅ COMPLETE
**Build Verification**: ✅ TypeScript passes · ESLint passes · Compiles successfully
**Location**: `/src/types/`

---

## Overview

The domain model consists of **13 core entities** representing the complete data structure for SAM Flow AI. All types are strictly typed with no `any` types, properly modeled relationships, and comprehensive DTO support for service layers.

**Key Principle**: The model is data-focused, not UI-focused. Each entity represents a business concept with clear ownership and relationships.

---

## Entity Relationships

```
Company (root)
├── User (multi-user, team roles)
├── Product (what they sell)
├── AnnualPlan
│   ├── QuarterlyPlan
│   │   └── MonthlyPlan
│   │       └── WeeklyPlan
│   ├── Initiative (many, owned by company)
│   │   ├── RecurringTemplate (spawns instances)
│   │   ├── Task (from project template)
│   │   ├── Result (weekly actuals)
│   │   └── Expense (cost tracking)
│   └── Projection (Good/Better/Best scenarios)
├── InitiativeType (library - "data, not code")
│   ├── ConversionBenchmark
│   └── CostBenchmark
├── PlanningInput (7 intake questions)
├── Subscription (billing tier)
└── BenchmarkParticipation (opt-in to data flywheel)
```

---

## Entity Details

### 1. **Company** (`company.types.ts`)
**Root entity** - represents a business using SAM Flow AI.

**Key Fields**:
- `name`, `description`
- `fiscalYear`, `planningYear`, `currency`
- `priorYearRevenue`, `targetRevenue`, `baselineRevenue`, `stretchRevenue`
- `operatingBudget` (70% of baseline per spec)

**Relationships**: Owns all other entities except InitiativeType (shared library).

---

### 2. **User** (`user.types.ts`)
**Team management** - represents users with roles within a company.

**Key Fields**:
- `companyId` (foreign key)
- `email`, `firstName`, `lastName`
- `role`: `'owner' | 'operator' | 'team_member' | 'viewer'`
- `marketingSignature?` (future Signature Talk module)
- `stageOfBusiness?` (early_stage | scaling | established_1m | established_10m | enterprise)

**Purpose**: Support multi-user workflows and operator-led companies ($2M-$10M segment).

---

### 3. **Product** (`product.types.ts`)
**Offerings** - what the business sells.

**Key Fields**:
- `name`, `description`, `price`
- `revenueType`: `'one-time' | 'recurring'`
- `ticketTier`: `'low' | 'mid' | 'high'` (ladder balance)
- `displayOrder` (for ranking in UI)

**Relationships**: Initiatives map to products; revenue projections roll up by product.

---

### 4. **Plan** (`plan.types.ts`)
**Planning hierarchy** - the layered cadence (annual → quarterly → monthly → weekly).

**Four Types**:
- **AnnualPlan**: Top-level frame with baseline/stretch goals, operating budget
- **QuarterlyPlan**: Strategy reshape; critical adjustment point
- **MonthlyPlan**: Trajectory tune; monthly review
- **WeeklyPlan**: Operating heartbeat; 5-step cadence

**Key Constraint**: Plans flow downward; results flow upward. The weekly loop drives the entire system.

---

### 5. **PlanningInput** (`planning-input.types.ts`)
**Intake questionnaire** - the 7 questions that drive plan generation.

**Q1**: Revenue goal & timeframe (3, 6, or 12 months)
**Q2**: Products & pricing (IDs linked to Product entities)
**Q3 & Q7**: What's worked / What hasn't (combined as "wins and struggles")
**Q4**: Ideal customer description
**Q5**: Current assets (email list, social, traffic, customers)
**Q6**: Budget & team (monthly budget, team size, roles)

**Routes**:
- `quickstart`: ~3 questions → rough plan in 2 minutes
- `full`: All 7 questions → tailored plan
- `foundation`: Pre-planning work (future, Phase 4)

---

### 6. **InitiativeType** (`initiative-type.types.ts`)
**The library** - "data, not code" (spec Section 6.4).

**Critical Design**:
- Each type stores: benchmarks, project template, difficulty dimensions, AI context
- Adding a new type is a **content task**, not engineering
- **Tier system**: Tier 1 (core 8-12), Tier 2 (next wave), Tier 3 (long tail)

**Key Substructures**:

**BenchmarkScenario**:
```typescript
{
  conservative: number;
  moderate: number;
  aggressive: number;
}
```

**DifficultyDimensions** (4D):
```typescript
{
  effortToImplement: 1-10;        // total task-hours
  skillExpertiseRequired: 1-10;   // can solo non-marketer do it?
  timeToResults: 1-10;            // how fast does it pay off?
  costToRun: 1-10;                // money required
}
```

**ProjectTemplate**:
```typescript
{
  tasks: [
    {
      name: string;
      daysBeforeEvent: number;  // relative to event date (e.g., -21)
      estimatedHours: number;
      roles: string[];
      dependencies: string[];   // task IDs
      ...
    }
  ];
  totalEstimatedHours: number;
}
```

**Why This Matters**: Lead-time logic (tasks relative to event date) enables the weekly horizon views. Hardcoding would break.

---

### 7. **Initiative** (`initiative.types.ts`)
**The unit of planning and execution**.

**Critical Design**: `kind` determines rendering and date logic.

**InitiativeKind**:
- `'one-time'`: Fixed event date; terminal state (done)
  - Date anchors: `activationDate` (promo launch), `eventDate`
  - Query: "Does period contain event date?"
  
- `'recurring'`: Generates instances from template
  - E.g., "2 webinars per quarter" → 8 instances/year
  - Each instance is a one-time initiative
  - Query: "Does period overlap with an instance?"
  
- `'evergreen'`: Always-on state
  - Date anchor: `activationDate` (launch date only)
  - No `eventDate`; never terminal
  - Query: "Does period fall between launch and retirement?"

**Key Fields**:
- `initiativeTypeId` (links to library)
- `productId` (what it sells)
- `status`: planned | in_progress | launched | completed | paused | retired
- `revenueScenarios`: { good, better, best }
- `plannedBudget`, `actualSpend`
- `roi`: derived from (revenue - spend) / spend

**RecurringTemplate**:
- Spawns one-time instances
- Stores `frequencyPerQuarter` and `promoOffsetDays`
- Each instance computes: `promoLaunchDate = eventDate - promoOffsetDays`

---

### 8. **Task** (`task.types.ts`)
**Execution tracking** - comes from initiative's project template.

**Key Fields**:
- `initiativeId` (which initiative)
- `dueDate` (lead-time derived: `initiative.eventDate + template.daysBeforeEvent`)
- `status`: not_started | in_progress | completed | blocked | cancelled
- `priority`: low | medium | high | critical
- `assignedToUserId?` (optional; v1 doesn't require assignment)
- `dependencyIds`: task IDs that must complete first
- `estimatedHours`, `actualHours`

**Critical**: Dates are computed, not manually entered. If event date changes, all task dates recalculate.

---

### 9. **Result** (`result.types.ts`)
**Actuals** - weekly entries of real outcomes.

**Two Types**:

**InitiativeResult**:
```typescript
{
  initiativeId: string;      // specific initiative
  weekStartDate, weekEndDate;
  actualRevenue: number;
  actualSpend: number;
  metrics: { [key: string]: number }; // e.g., { show_rate: 0.45 }
}
```

**EvergreenResult**:
```typescript
{
  productId: string;         // NOT initiativeId
  initiativeId?: null;       // explicitly null for evergreen
  weekStartDate, weekEndDate;
  actualRevenue: number;
  actualSpend: number;
  metrics: { [key: string]: number };
}
```

**Why Separate?** Evergreen initiatives don't have an event date. Results must link to a product instead (per spec Section 1.2).

**Purpose**: Feeds the weekly cadence, accountability layer, and benchmark flywheel.

---

### 10. **Projection** (`projection.types.ts`)
**Revenue forecasting** - Good/Better/Best scenarios.

**Key Fields**:
- `scenario`: 'good' | 'better' | 'best' (conservative | moderate | aggressive)
- `period`: 'monthly' | 'quarterly' | 'annual'
- `byProduct`: Revenue by product
- `byInitiative`: Revenue by initiative
- `monthly?`, `quarterly?`, `annual?`: Detailed breakdowns

**ProjectionSummary**:
Quick view of all three scenarios with growth metrics.

**Derived From**: Initiative's `revenueScenarios` × benchmark conversion rates.

---

### 11. **Benchmark** (`benchmark.types.ts`)
**The moat** - industry and historical conversion/cost data.

**Two Types**:

**ConversionBenchmark**:
```typescript
{
  initiativeTypeId: string;
  fieldName: string;              // e.g., 'registration_rate'
  data: { conservative, moderate, aggressive };
  source: 'first_party' | 'partner_shared' | 'published' | 'industry_report';
  sourceDetails?: string;         // citation, date, sample size
  initiativeTypeVersion: string;  // track versioning
}
```

**CostBenchmark**:
```typescript
{
  initiativeTypeId: string;
  costMetric: string;             // e.g., 'cost_per_lead'
  data: { conservative, moderate, aggressive };
  source: BenchmarkSource;
  sourceDetails?: string;
  initiativeTypeVersion: string;
}
```

**Key**: Versioning allows old initiatives to keep original benchmarks; new initiatives use updated rates.

---

### 12. **Expense** (`expense.types.ts`)
**Cost tracking** - per-initiative line items.

**Key Fields**:
- `initiativeId`
- `category`: advertising | talent | tools | production | venue | fulfillment | other
- `amount`, `date`
- `source`: 'manual' | 'integration' (Phase 17+)

**v1 Scope**: Simplified `plannedBudget` + `actualSpend` on Initiative entity.
**Future**: Itemized Expense rows for audit-level detail.

---

### 13. **Report** (`report.types.ts`)
**Analytics** - business reporting.

**Report Types**:
- `revenue_summary`: Total by period
- `revenue_by_product`: Breakdown by product
- `revenue_by_initiative`: Breakdown by initiative
- `expense_summary`: Cost breakdown
- `roi_analysis`: Return on investment
- `weekly_status`: Weekly cadence summary
- `monthly_review`, `quarterly_review`, `annual_review`: Periodic reviews

**Key Metrics**:
- `totalRevenue`, `totalExpenses`, `netRevenue`, `grossMargin`
- `revenueByProduct[]`, `revenueByInitiative[]`, `expenseByCategory[]`, `roiAnalyses[]`

---

### 14. **Subscription** (`subscription.types.ts`)
**Billing** - tiers and account status.

**Tiers** (from spec Section 14.2):
| Tier | Monthly | Annual | Features |
|------|---------|--------|----------|
| Starter | $49 | $490 | 1 company, 1 user |
| Pro | $149 | $1,490 | 1 company, 5 users, analytics |
| Mastery | — | $4,997 | 1 company, 10 users, 3 reviews/year, support |

**Key Fields**:
- `tier`, `billingCycle`, `status`
- `startDate`, `renewalDate`, `cancelledAt?`
- `isTrialActive`, `trialEndsAt?`
- `stripeCustomerId?`, `stripeSubscriptionId?` (Phase 13)

**BenchmarkParticipation**:
- Opt-in to benchmark data flywheel (Phase 16)
- Separate consent: `allowBenchmarkContribution`, `allowIntegrationDataUse`

---

## File Structure

```
src/types/
├── company.types.ts          (Company)
├── user.types.ts              (User)
├── product.types.ts            (Product)
├── plan.types.ts              (AnnualPlan, QuarterlyPlan, MonthlyPlan, WeeklyPlan)
├── planning-input.types.ts     (PlanningInput - 7 intake questions)
├── initiative-type.types.ts    (InitiativeType - the library)
├── initiative.types.ts         (Initiative, RecurringTemplate)
├── task.types.ts              (Task)
├── result.types.ts            (InitiativeResult, EvergreenResult)
├── projection.types.ts        (Projection, ProjectionSummary)
├── benchmark.types.ts         (ConversionBenchmark, CostBenchmark)
├── expense.types.ts           (Expense)
├── report.types.ts            (Report)
├── subscription.types.ts       (Subscription, BenchmarkParticipation, TIER_CONFIGS)
└── index.ts                   (barrel export)
```

---

## TypeScript Features

### Strict Typing
- ✅ No `any` types anywhere
- ✅ All unions explicitly defined (`'one-time' | 'recurring' | 'evergreen'`)
- ✅ DTO pattern for service layer abstraction
- ✅ Discriminated unions for Result (InitiativeResult vs. EvergreenResult)

### Date Handling
- ✅ All dates are `Date` type (not strings)
- ✅ Relative dates stored on templates; absolute dates computed on instances

### Composition
- ✅ No circular dependencies
- ✅ Foreign keys stored as `string` IDs (not nested objects)
- ✅ DTOs separate input validation from domain model

### Export Pattern
```typescript
// Barrel export (src/types/index.ts)
export type { Company, CreateCompanyDTO, UpdateCompanyDTO } from './company.types';
export type { /* all other types */ } from './...';
export { TIER_CONFIGS } from './subscription.types'; // only non-type export
```

**Usage in services**:
```typescript
import type { Initiative, CreateInitiativeDTO } from '@/types';

export class InitiativeService {
  async createInitiative(dto: CreateInitiativeDTO): Promise<Initiative> {
    // implementation
  }
}
```

---

## Design Decisions

### 1. **InitiativeKind Determines Everything**
The `kind` field on Initiative drives:
- Date query logic (what period contains this initiative?)
- Rendering across horizons (morphs | multiplies | persists)
- Task scheduling (relative to event date)
- Result attribution (specific initiative vs. evergreen/product)

**Rationale**: Conflating one-time and evergreen breaks horizon views (Phase 6). This is THE foundational decision.

### 2. **RecurringTemplate Immutability**
Recurring instances are spawned from a template at creation time. If the template changes later:
- Existing instances keep original dates
- New instances use updated template

**Rationale**: Changing past event dates would cascade failures through tasks and results.

### 3. **Evergreen Results Link to Product**
Evergreen initiatives don't have an event date, so results must link to `productId` instead of `initiativeId`.

**Rationale**: From spec Section 1.2: "Evergreen results need a home — they do not hang off an initiative, so they attribute to a product."

### 4. **InitiativeType as Data**
All initiative types (benchmarks, templates, difficulty) are stored as structured JSON, not hardcoded.

**Rationale**: Spec Section 6.4: "Adding a new initiative type is a content task, not an engineering task."

### 5. **Benchmark Versioning**
Each benchmark carries `initiativeTypeVersion` to track when it was created.

**Rationale**: Benchmarks evolve; old initiatives should keep their original data; new ones use latest.

### 6. **User Roles and Multi-User**
User model includes roles and `stageOfBusiness` to support team workflows and future role-based dashboards.

**Rationale**: Spec Section 4: "At the upper end ($2M–$10M), the buyer is the operator...The product has to serve both buyers."

---

## Phase 1.1 Exit Criteria: ✅ ALL MET

✅ **All domain interfaces created**: 14 entities + DTOs
✅ **Relationships modeled correctly**: Ownership clear, foreign keys as IDs
✅ **Strict typing**: No `any`, discriminated unions, DTO pattern
✅ **Barrel exports**: Single import point (`@/types`)
✅ **No business logic**: Pure type definitions
✅ **TypeScript compiles cleanly**: `tsc --noEmit` passes
✅ **Next.js build passes**: Full build succeeds

---

## Next Steps (Phase 1.2+)

### Phase 1.2: Mock Data
Create realistic JSON files in `/src/mock/data/`:
- `company.json` - test company
- `products.json` - 2-3 products
- `initiative-types.json` - Tier 1 library (8-12 fully specced)
- `initiatives.json` - 3-5 sample initiatives in various states
- `tasks.json` - tasks with lead-time calculations
- etc.

### Phase 1.3: Service Layer
Build 11 services in `/src/services/`:
- Each wraps mock data
- Never returns raw JSON
- All services follow the DTO pattern
- All services tested

### Phase 2: Application Shell
Once services are solid, build UI on top (sidebar, header, breadcrumbs, etc.)

---

## Improvements & Future Considerations

### Minor Enhancements (Post-Approval)

1. **Validation Rules in Comments**
   Add JSDoc comments specifying constraints:
   ```typescript
   interface Initiative {
     /** Must be between 1 and 10,000,000 **/
     trafficInput?: number;
   }
   ```

2. **Enum vs. String Unions**
   Current: `type InitiativeKind = 'one-time' | 'recurring' | 'evergreen'`
   Could be: `enum InitiativeKind { ONE_TIME = 'one-time', ... }`
   
   **Decision**: String unions are fine for now; easier to serialize to JSON.

3. **Readonly Fields**
   Add `readonly` to immutable fields:
   ```typescript
   readonly id: string;
   readonly createdAt: Date;
   ```

4. **Brand Types for IDs**
   Use branded types to prevent mixing IDs:
   ```typescript
   type CompanyId = string & { readonly brand: 'CompanyId' };
   type InitiativeId = string & { readonly brand: 'InitiativeId' };
   ```
   
   **Decision**: Skip for now; add if ID mixing becomes an issue.

5. **Event Type Interfaces**
   For event sourcing (Phase 16 integration), add:
   ```typescript
   interface InitiativeCreatedEvent {
     type: 'InitiativeCreated';
     initiative: Initiative;
     timestamp: Date;
   }
   ```
   
   **Decision**: Defer until event sourcing is needed.

---

## Summary

**Phase 1.1 is complete.** The domain model is production-ready:
- ✅ 13 core entities + billing/subscription
- ✅ Strict TypeScript with no `any` types
- ✅ Clear relationships and ownership
- ✅ DTOs for service layer abstraction
- ✅ Compiles cleanly with Next.js 16.2.10

**Next**: Mock data creation (Phase 1.2) and service layer (Phase 1.3).

---

**Created**: July 6, 2026
**Status**: COMPLETE & APPROVED FOR NEXT PHASE
