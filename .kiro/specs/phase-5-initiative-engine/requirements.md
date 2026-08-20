# Requirements Document

## Introduction

Phase 5 - Initiative Engine is the heart of SAM Flow AI, serving as the revenue operating system that connects planning to execution. Everything in the application revolves around Initiatives. This phase delivers the complete lifecycle management for initiatives, from selection and planning through execution, tracking, and accountability.

The Initiative Engine must support the weekly operating loop where users enter results, compare against plan, see what's moving, adjust plans, and set weekly priorities. It must also support the three-tier rollout approach starting with ~8-12 core initiative types that cover 90% of typical business growth activities.

## Glossary

- **Initiative**: A specific business activity that drives revenue, such as a webinar, email campaign, or sales call. It is the fundamental unit of planning and execution.
- **Initiative Type**: A reusable template that defines the conversion benchmarks, project template, difficulty dimensions, and AI context for a category of initiatives. Stored as data, not code.
- **One-time Initiative**: An initiative with a fixed event date that resolves when completed (e.g., a live webinar, product launch).
- **Recurring Initiative**: A template that generates multiple one-time instances on a schedule (e.g., "two flagship webinars per quarter").
- **Evergreen Initiative**: An always-on initiative with no terminal condition (e.g., evergreen webinar, always-on VSL funnel) that runs as a state.
- **Project Template**: A predefined set of tasks with sequencing, dependencies, roles, and durations that instantiates when creating an initiative.
- **Conversion Benchmark**: Industry or first-party data defining conservative, moderate, and aggressive conversion rates for different metrics (e.g., registration rate, show-up rate, offer conversion).
- **Difficulty Dimensions**: Four metrics (effort to implement, skill required, time to results, cost to run) that quantify the complexity of an initiative type.
- **Tier 1 Initiatives**: The core set of ~8-12 initiative types that cover 90% of typical business growth activities (Webinar, email campaign, challenge/boostcamp, paid ads, VSL/sales page, sales calls, content & organic social, referral).
- **Project**: A collection of tasks instantiated from an initiative type's project template.
- **Task**: A specific action item with a due date, assignee, status, and estimated/actual hours.
- **Result**: Actual revenue and spend data entered by the user for an initiative, used to track performance against projections.
- **Expense**: Individual cost line items associated with an initiative.
- **Budget**: Planned expenditure for an initiative vs. actual spend.
- **ROI**: Return on Investment = (Revenue - Spend) / Spend * 100.

## Requirements

### Requirement 1: Initiative Library Management

**User Story:** As a business operator, I want to view and manage all initiatives, so that I can track my growth activities and see what's planned.

#### Acceptance Criteria

1. THE Initiative Library SHALL display all initiatives for the company with sorting, filtering, and search capabilities
2. WHEN the user filters initiatives, THE Initiative Library SHALL apply the selected filters and update the list
3. WHERE the user searches initiatives, THE Initiative Library SHALL filter results by name, description, or initiative type name
4. WHILE viewing the Initiative Library, THE System SHALL show initiative status, type, product, activation date, and summary metrics (planned budget, actual spend, ROI)
5. IF an initiative has no results entered for the current period, THEN THE Initiative Library SHALL indicate "No results this period"
6. WHERE the user clicks on an initiative, THEN THE System SHALL navigate to the Initiative Detail page

### Requirement 2: Initiative Detail Overview

**User Story:** As a business operator, I want to view comprehensive information about a specific initiative, so that I can understand its purpose, metrics, and execution status.

#### Acceptance Criteria

1. WHEN the user navigates to an initiative detail page, THE System SHALL display the initiative name, description, status, and type
2. WHILE viewing an initiative, THE System SHALL show key metrics: planned revenue (Good/Better/Best scenarios), actual revenue, planned budget, actual spend, ROI, and variance metrics
3. WHERE the initiative is one-time, THE System SHALL display the event date and promo launch date
4. WHERE the initiative is recurring, THE System SHALL display the schedule (e.g., "2× per quarter") and show spawned instances
5. WHERE the initiative is evergreen, THE System SHALL display the launch date and retirement date (if retired)
6. IF the initiative is in the past or retired, THEN THE System SHALL show completed status with summary metrics
7. WHERE the user clicks "View Project", THEN THE System SHALL navigate to the Project Plan section
8. WHERE the user clicks "View Results", THEN THE System SHALL navigate to the Results section
9. WHERE the user clicks "View Expenses", THEN THE System SHALL navigate to the Expenses section

### Requirement 3: Revenue Scenarios

**User Story:** As a business operator, I want to see projected revenue scenarios for each initiative, so that I can understand the range of expected outcomes and measure performance against them.

#### Acceptance Criteria

1. FOR EACH initiative, THE System SHALL calculate and display three revenue scenarios based on initiative type benchmarks: Good (conservative), Better (moderate), and Best (aggressive)
2. WHERE the user enters actual results for an initiative, THEN THE System SHALL display the variance between actuals and each scenario
3. WHEN the user adjusts conversion rate assumptions, THE System SHALL recalculate all three revenue scenarios
4. FOR EACH scenario, THE System SHALL display the underlying assumptions (e.g., traffic input, conversion rates, average ticket)
5. WHERE the initiative is recurring, THE System SHALL aggregate scenarios across all instances
6. WHERE the initiative is evergreen, THE System SHALL display run-rate projections (e.g., monthly or quarterly)

### Requirement 4: Benchmark Reference

**User Story:** As a business operator, I want to see the conversion benchmarks used for an initiative, so that I can understand the assumptions behind projections and refine them if needed.

#### Acceptance Criteria

1. WHEN the user views an initiative, THE System SHALL display the benchmark source (first-party, partner-shared, published) and data quality indicators
2. WHERE the initiative type has conversion benchmarks, THE System SHALL show the conservative, moderate, and aggressive values for each metric
3. FOR EACH benchmark metric, THE System SHALL display the field description (e.g., "Registration Rate" instead of just "registration_rate")
4. WHERE the user has entered actual results, THE System SHALL compare actuals to the moderate benchmark
5. WHEN the user clicks on a benchmark metric, THE System SHALL show the data source details (citation, date range, sample size)
6. IF no benchmarks exist for an initiative type, THEN THE System SHALL use industry average benchmarks with appropriate caveats

### Requirement 5: Initiative Project Plan

**User Story:** As a business operator, I want to see the project plan for an initiative, so that I can understand what needs to be done and track progress toward launch.

#### Acceptance Criteria

1. WHEN an initiative is created, THE System SHALL instantiate tasks from the initiative type's project template
2. WHERE an initiative has tasks, THE System SHALL display them with status, due date (relative to event date), assignee, and estimated hours
3. FOR tasks that are overdue, THE System SHALL highlight them and show days overdue
4. FOR tasks with dependencies, THE System SHALL show the dependency chain and indicate if blockers exist
5. WHERE the user clicks on a task, THE System SHALL open the Task Detail panel with full information
6. WHEN the user clicks "Edit Project", THE System SHALL allow modification of task dates, assignees, and estimated hours
7. IF an initiative is one-time, THEN THE System SHALL calculate task due dates relative to the event date
8. IF an initiative is recurring, THEN THE System SHALL calculate task due dates relative to each instance's event date
9. IF an initiative is evergreen, THEN THE System SHALL show recurring upkeep tasks with dates based on the current period

### Requirement 6: Task Management

**User Story:** As a business operator, I want to manage tasks across initiatives, so that I can track what's due and ensure execution happens on time.

#### Acceptance Criteria

1. WHEN the user views the Task List, THE System SHALL display all tasks for active initiatives with status, due date, priority, and assignee
2. WHERE the user filters tasks, THE System SHALL apply filters by status, due date range, assignee, or initiative
3. FOR tasks due this week, THE System SHALL highlight them for weekly focus
4. WHERE the user clicks on a task, THEN THE System SHALL open the Task Detail panel
5. WHILE viewing a task, THE System SHALL show edit, delete, and status update buttons
6. WHEN the user updates a task status, THE System SHALL save the change and update the task list
7. WHERE the user adds a new task, THE System SHALL create it and link it to the appropriate initiative
8. WHEN the user deletes a task, THE System SHALL prompt for confirmation before removing it
9. WHERE the user clicks "Add Task to Initiative", THEN THE System SHALL pre-populate the initiative context and create the task

### Requirement 7: Initiative Type Data Model

**User Story:** As a product maintainer, I want initiative types to be stored as data (not code), so that I can add, modify, or remove initiative types without engineering effort.

#### Acceptance Criteria

1. WHEN a new initiative type is added, THE System SHALL store it as a structured data record with all required fields
2. WHERE the system loads initiative types, THE System SHALL read from the data store at runtime
3. FOR EACH initiative type, THE System SHALL store:
   - Name, channel, and description
   - Conversion benchmarks for all relevant metrics (conservative, moderate, aggressive)
   - Project template with task list, sequencing, and durations
   - Difficulty dimensions (effort to implement, skill required, time to results, cost to run)
   - AI context for the generator (when to recommend, sizing guidance, recommendation weights)
   - Tier (1, 2, or 3) and display order
   - Owner flag (system vs. user-created)
   - Activation and retirement dates (for type lifecycle management)
4. IF the system needs initiative type data, THEN THE System SHALL fetch it from the data store
5. WHERE the user modifies an initiative type, THE System SHALL save the changes and update all new initiatives
6. WHERE a user modifies an initiative type that has existing initiatives, THE System SHALL warn about potential impacts
7. FOR Tier 1 initiative types, THE System SHALL require benchmarks, project template, and AI context to be complete
8. WHERE an initiative type is marked inactive, THE System SHALL prevent new initiatives from using it but allow existing initiatives to continue

### Requirement 8: Four Difficulty Dimensions

**User Story:** As a business operator, I want to understand the difficulty of initiatives, so that I can match them to my team's capabilities and resources.

#### Acceptance Criteria

1. FOR EACH initiative type, THE System SHALL store four difficulty dimensions with values from 1-10:
   - Effort to implement (total task-hours from template)
   - Skill/expertise required (can a solo non-marketer do it?)
   - Time to results (how fast does it pay off?)
   - Cost to run (money required)
2. WHEN an initiative is displayed, THE System SHALL show a difficulty indicator for each dimension
3. WHERE an initiative has high difficulty in any dimension, THE System SHALL show a "You may want help with this" flag
4. FOR the AI initiative generator, THE System SHALL use the four dimensions to match initiatives to user constraints (budget, team size, timeframe, skill level)
5. WHERE the user filters initiatives by difficulty, THE System SHALL apply filters across all four dimensions
6. IF an initiative's difficulty exceeds user constraints, THEN THE System SHALL warn the user before selection
7. FOR Tier 1 initiatives, THE System SHALL ensure difficulty dimensions are calibrated against historical execution data

### Requirement 9: Three-Tier Rollout Support

**User Story:** As a product manager, I want to support a tiered rollout of initiative types, so that we can launch with a focused set of 8-12 core types and expand over time.

#### Acceptance Criteria

1. WHERE an initiative type is assigned Tier 1, THE System SHALL include it in the core library displayed by default
2. WHERE an initiative type is assigned Tier 2, THE System SHALL include it in an expanded library accessible via "View More"
3. WHERE an initiative type is assigned Tier 3, THE System SHALL show it in a specialized view with a note about generic templates
4. FOR Tier 1 initiative types, THE System SHALL require complete benchmarks, project templates, and AI context
5. FOR Tier 2 initiative types, THE System SHALL allow partial implementation but warn about missing data
6. FOR Tier 3 initiative types, THE System SHALL support generic templates generated by AI with minimal manual configuration
7. WHEN the user selects an initiative type, THE System SHALL display its tier indicator
8. IF a user tries to create an initiative with a Tier 3 type, THEN THE System SHALL guide them through AI-assisted template creation
9. WHERE initiative type data is updated, THE System SHALL maintain tier-specific validation rules

### Requirement 10: One-time Initiative Execution

**User Story:** As a business operator, I want to execute one-time initiatives from planning through completion, so that I can track the full lifecycle and learn from each event.

#### Acceptance Criteria

1. FOR a one-time initiative, THE System SHALL display a promo launch date and event date
2. WHERE the current date is before the promo launch date, THE System SHALL show the initiative as "planned" and not clutter near-term views
3. WHERE the current date is between promo launch and event date, THE System SHALL show the initiative as "in_progress" with ramp-up tasks highlighted
4. WHERE the current date is after the event date, THE System SHALL show the initiative as "completed" or "launched"
5. FOR a one-time initiative, THE System SHALL calculate due dates for project tasks relative to the event date (e.g., "send first email 21 days before event")
6. WHERE the user updates the event date, THE System SHALL recalculate all task due dates and warn about impacts
7. IF a one-time initiative is completed, THEN THE System SHALL archive it from active views after 30 days
8. WHERE the user wants to recreate an initiative, THE System SHALL allow cloning from the archive

### Requirement 11: Recurring Initiative Execution

**User Story:** As a business operator, I want to run recurring initiatives on a schedule, so that I don't have to set up the same initiative multiple times.

#### Acceptance Criteria

1. FOR a recurring initiative, THE System SHALL store an event schedule (e.g., "2× per quarter", "weekly") and promo offset (e.g., "promo opens 21 days before event")
2. WHEN the system generates instances, THE System SHALL create one-time initiative instances for each scheduled event with calculated promo launch dates
3. WHERE the user modifies the promo offset, THE System SHALL update all future instances automatically
4. FOR recurring initiatives, THE System SHALL aggregate metrics across all instances for the current period
5. WHERE the user views the initiative detail, THE System SHALL show the template and list of spawned instances
6. FOR each instance, THE System SHALL show its individual status, results, and project plan
7. IF a past instance is completed, THE System SHALL archive it individually without affecting the template
8. WHERE the user wants to edit the template, THE System SHALL warn about impacts to future instances

### Requirement 12: Evergreen Initiative Execution

**User Story:** As a business operator, I want to run evergreen initiatives that continue indefinitely, so that I can track their ongoing performance.

#### Acceptance Criteria

1. FOR an evergreen initiative, THE System SHALL store a launch date and optional retirement date
2. WHERE the current date is before the launch date, THE System SHALL show the initiative as "planned"
3. WHERE the current date is between launch and retirement, THE System SHALL show the initiative as "active"
4. WHERE the current date is after the retirement date, THE System SHALL show the initiative as "retired"
5. FOR an evergreen initiative, THE System SHALL calculate run-rate metrics (e.g., monthly revenue, weekly task completion)
6. WHERE the user enters results, THE System SHALL record them as ongoing measurements rather than single events
7. FOR evergreen initiatives, THE System SHALL display the most recent result date and trend indicator
8. IF the user wants to pause an evergreen initiative, THEN THE System SHALL mark it as "paused" and resume when reactivated

### Requirement 13: Revenue and Spend Capture

**User Story:** As a business operator, I want to enter actual revenue and spend for initiatives, so that I can track performance and calculate ROI.

#### Acceptance Criteria

1. WHEN the user enters actual revenue for an initiative, THE System SHALL save it and recalculate ROI
2. WHEN the user enters actual spend for an initiative, THE System SHALL save it and update the spend-vs-budget calculation
3. WHERE the user enters multiple result entries, THE System SHALL store them as historical results with timestamps
4. FOR one-time initiatives, THE System SHALL require a single result entry after the event date
5. FOR evergreen initiatives, THE System SHALL accept multiple result entries over time (weekly, monthly)
6. WHERE the user enters a result, THE System SHALL link it to the initiative, product, and period
7. IF the user tries to enter a result for a past period, THEN THE System SHALL allow it with a warning about plan vs. actual mismatch
8. WHEN the user enters a result, THE System SHALL update summary metrics immediately

### Requirement 14: Expense Tracking

**User Story:** As a business operator, I want to track expenses for initiatives, so that I can understand the true cost of each growth activity.

#### Acceptance Criteria

1. WHEN the user adds an expense to an initiative, THE System SHALL create an expense record with category, amount, date, and source
2. WHERE the user views an initiative, THE System SHALL display total planned budget, actual spend, and itemized expenses
3. FOR expenses, THE System SHALL support categories (ad spend, creative, platform fees, staffing, external services)
4. WHEN the user adds an expense with a date before the promo launch, THE System SHALL still accept it (for prep costs)
5. WHERE the user filters initiatives by spend, THE System SHALL apply filters on actual spend or budget variance
6. IF actual spend exceeds planned budget, THE System SHALL show a budget overrun warning
7. FOR recurring initiatives, THE System SHALL sum expenses across all instances for the period
8. FOR evergreen initiatives, THE System SHALL show cumulative spend and run-rate cost metrics

### Requirement 15: Results Log and Historical Tracking

**User Story:** As a business operator, I want to see historical results for initiatives, so that I can track trends and identify what's working.

#### Acceptance Criteria

1. WHERE the user views an initiative, THE System SHALL display the results log with all historical entries
2. FOR each result entry, THE System SHALL show the date, revenue, spend, net, ROI, and notes
3. WHEN the user deletes a result entry, THE System SHALL prompt for confirmation and update summary metrics
4. WHERE the user adds a result, THE System SHALL allow optional notes about what happened
5. FOR evergreen initiatives, THE System SHALL display results as a time series with chart visualization
6. FOR one-time initiatives, THE System SHALL display the single result as a card with full details
7. WHERE the user wants to compare initiatives, THE System SHALL show a side-by-side comparison of key metrics
8. IF a result entry is marked as "draft", THE System SHALL exclude it from summary calculations until published

### Requirement 16: Weekly Operating Loop Integration

**User Story:** As a business operator, I want to use the Initiative Engine as part of my weekly operating loop, so that I can drive consistent execution and accountability.

#### Acceptance Criteria

1. WHEN the user completes the "Enter Results" step, THE System SHALL update all active initiatives with new result data
2. WHERE the user views the "See Where You Are" step, THE System SHALL show actuals vs. plan by initiative with variance indicators
3. FOR the "See What's Moving" step, THE System SHALL surface overdue tasks, upcoming events, and budget alerts
4. WHERE the user adjusts a plan based on results, THE System SHALL allow editing initiative dates, budgets, or assumptions
5. FOR the "Top Priorities This Week" step, THE System SHALL surface the 1-3 highest-impact initiatives with the fewest completed tasks
6. IF the system detects revenue is tracking behind plan, THEN THE System SHALL suggest budget adjustments to stay solvent
7. WHERE an initiative has high spend but low revenue, THE System SHALL flag it for review
8. WHEN the user completes the weekly loop, THE System SHALL save the adjusted plan for the next period

### Requirement 17: Initiative Selection and Generation

**User Story:** As a business operator, I want to select initiatives that match my business context, so that I don't waste time on activities that won't work for me.

#### Acceptability Criteria

1. WHEN the AI initiative generator runs, THE System SHALL use the four difficulty dimensions to match initiatives to user constraints
2. WHERE the user's budget is low, THE System SHALL weight against high-cost-to-run initiative types
3. WHERE the user's team size is small, THE System SHALL weight against high-effort-to-implement initiative types
4. WHERE the user has limited timeframe, THE System SHALL weight against high-time-to-results initiative types
5. WHERE the user has a specific skill gap, THE System SHALL weight against high-skill-required initiative types
6. FOR initiatives that match the user's historical success, THE System SHALL boost their recommendation score
7. FOR initiatives the user has tried and failed, THE System SHALL deprioritize them unless there's a strong reason to retry
8. WHERE the user accepts AI-generated initiatives, THE System SHALL create them with all templates and benchmarks applied
9. IF the user wants to add an initiative manually, THEN THE System SHALL require initiative type selection with full configuration

### Requirement 18: Data Persistence and Service Layer

**User Story:** As a developer, I want the Initiative Engine to use the service layer for all data operations, so that the UI never imports JSON directly.

#### Acceptability Criteria

1. ALL initiative-related data operations SHALL use initiativeService, initiativeTypeService, taskService, resultService, expenseService
2. WHERE the UI needs initiative data, THE System SHALL call the service layer, not read JSON files
3. FOR testing, THE System SHALL use mock data through services with delay simulation
4. WHEN Supabase integration is added, THE System SHALL replace service implementations without changing UI
5. ALL services SHALL return Promises and handle errors consistently
6. WHERE a service method fails, THE System SHALL show an error state with retry capability

### Requirement 19: Filter and Search Functionality

**User Story:** As a business operator, I want to filter and search initiatives, so that I can find specific activities quickly.

#### Acceptability Criteria

1. WHERE the user applies a filter, THE System SHALL update the initiative list in real-time
2. FOR status filters, THE System SHALL support: all, planned, in_progress, launched, completed, paused, retired
3. FOR initiative type filters, THE System SHALL support selecting one or multiple types
4. FOR product filters, THE System SHALL support selecting one or multiple products
5. FOR date range filters, THE System SHALL support: this week, this month, this quarter, next month, custom range
6. WHERE the user enters search text, THE System SHALL filter initiatives by name, description, or initiative type name
7. FOR Tier filters, THE System SHALL support selecting tiers 1, 2, and/or 3
8. WHERE filters are applied, THE System SHALL display the count of matching initiatives
9. WHEN the user clears filters, THE System SHALL restore the full initiative list

### Requirement 20: UI/UX Consistency

**User Story:** As a business operator, I want a consistent interface across the Initiative Engine, so that I can navigate without relearning.

#### Acceptability Criteria

1. ALL initiative list views SHALL use the same table layout with consistent columns
2. WHERE an initiative detail page is displayed, THE System SHALL use the same section headers (Overview, Revenue, Budget, ROI, Registrants, Show Rate, Offer Conversion, Timeline)
3. FOR forms and modals, THE System SHALL use the same input styles and validation patterns
4. WHEN errors occur, THE System SHALL show consistent error messages with guidance on how to fix them
5. FOR loading states, THE System SHALL show consistent skeletons during data fetch
6. WHERE empty states are needed, THE System SHALL use the application's standard empty state component
7. FOR success/failure feedback, THE System SHALL use consistent toast notifications
8. WHEN the user navigates between initiative-related pages, THE System SHALL preserve filter and search state in URL parameters
