# SAM Plan AI - Technical Build Specification
[STRATEGY NOTE: We are currently in Phase 1: Frontend-First development using local JSON data inside /src/mock/data/. Do not generate live database connections or external API configurations until explicitly requested.]

A revenue operating system for service businesses and coaches
Working name. The product name “SAM Plan AI” is under review and likely to change before LLC filing. The name undersells the company by describing the smaller v1 (a sales-and-marketing plan) rather than what is actually being built (a revenue operating system). Category positioning to retain: “the revenue operating system” (analogous to how EOS owns “entrepreneurial operating system”). Brand name to develop: distinct, ownable, evocative — not generic (RevOS / RevenueOS are category words, not brand names). Decide jointly before filing.
Prepared for: the build team
Version 1.0 · Working build spec for v1 (Lovable) · Strategic context, partnership terms, and business model are in the separate strategic spec.
Contents
1. Product Overview
SAM Plan AI is a revenue operating system — the tool a business is actually managed by. It begins as a planning tool (a short intake produces a complete revenue plan with execution-ready project plans in minutes), but its real job is to be the system the business runs on: strategy feeds execution, execution produces results, results refine the strategy. Each week the plan is updated, refined, and adjusted against reality. The plan is not a document you make once; it is the living instrument you run the company by.
This is not a speculative concept. It is the productized version of a system that already runs a real business: a spreadsheet version of this exact method is used today for forecasting and budgeting (the finance team budgets against a percentage of the “good” scenario), for planning initiatives, and for fueling growth. The product externalizes a proven, decade-refined operating system — it does not invent one and hope the market wants it.
Framed as a planning tool, it answers four questions; framed as an operating system, those four become the weekly operating loop:
What should we do? — the AI Initiative Generator
How much will we make? — the Revenue Projections engine
How do we make it happen? — template-driven Project Plans
Are we on track? — the Execution & Accountability layer
The fourth question is the one most planning tools never answer, and it is where the durable value lives. A plan is not an outcome. See Section 2.
1.1 The core loop
Everything in the product flows through one loop. Build the loop first; everything else is an enhancement to it.
Intake → AI generates initiatives → Revenue projections → Project plans
The intake answers feed initiative selection. Each initiative carries an initiative type, which pulls the right conversion benchmarks (for the math) and the right project template (for execution). Projections and project plans flow out the other side.
1.2 The weekly cadence is the heartbeat
A revenue operating system lives or dies on rhythm. The product must DRIVE a weekly loop, not merely permit it. Each week, in order:
Complete results — enter initiative results (revenue and spend) and evergreen results for the week.
See where you are — actuals vs. plan, by initiative and product.
See what’s moving — what’s coming up, what’s due, what’s slipping.
Adjust if needed — refine initiatives, numbers, sequencing.
Top priorities this week — the 1–3 that matter most, with a clear #1.
That weekly touch is what makes it the operating system rather than a document the user made once and abandoned — and it is the structural answer to the retention problem that defeats ordinary planning tools.
Two design notes for the build. The order is deliberate: results are entered first, because the scoreboard in step 2 is only true once the week’s numbers are in — and leading with capture also drives the activation metric (Section 15.5). Step 5 is a forcing function, not a to-do list: cap it at three and force a ranked #1, or it quietly becomes the open-ended list it was meant to replace. And evergreen results need a home — they do not hang off an initiative, so they attribute to a product with no active initiative; the weekly tab and the data model must handle that case explicitly.
Crucially, the weekly cadence is also what organizes every other capability in this spec. The accountability layer is the weekly status. The check-ins are the weekly nudge. The actuals (eventually fed automatically — Section 16) are the weekly truth. Plan refinement is the weekly adjustment. The data flywheel is fed by the weekly inputs. These are not a pile of separate features; they are the components of one weekly operating rhythm. Hold this as the spine of the product.
Adoption note: customers do not adopt an operating system on day one. They adopt a useful tool that becomes indispensable, and then it becomes their OS — the way QuickBooks launched as check-writing software and became a financial OS over decades. The v1 is the seed: the plan plus the first weekly loop. You earn the right to be someone’s operating system one proven layer at a time. (See Section 13 for what that means for the build.)
1.3 The full planning cadence — annual, quarterly, monthly, weekly
The weekly cadence is the operating heartbeat, but it lives inside a layered planning structure. Each tier feeds the next: the weekly serves the monthly, the monthly serves the quarterly, the quarterly serves the annual. Plan changes flow upward when the data justifies them; commitments flow downward. The product surfaces what to look at and when, so the operator does not have to remember which tier they are in.
Annual — the frame. Set the baseline goal (typically last year’s revenue + 10–15%) and the stretch goal (significantly larger — where the business lands if everything works). Lay out the initiative plan that drives the annual number. Set the team structure, the major investments, the bets. The once-a-year exercise that anchors everything below it. The product walks the operator through this at year-start and produces both the plan document and the underlying initiative project plans.
Financial discipline at the annual tier (worth naming because most companies get this wrong): the finance team builds the operating budget against approximately 70% of baseline, NOT against stretch and NOT against baseline itself. Reasoning: the budget is what the company commits to spending against numbers it is confident it will make. Stretch is aspirational. Baseline already has a 10–15% growth assumption baked in. Building the budget against stretch — or even against baseline — creates downside exposure when launches miss or revenue lags. The cautionary tale that justifies the rule: a finance team that once budgeted against the launch goal, then watched the launch miss, then spent the rest of the year unwinding the over-commitment. The 70%-of-baseline rule prevents that. (In MRR-heavy businesses with predictable run-rate revenue, the budget can sit closer to baseline because the confidence is higher. In launch-heavy or info-marketing businesses, the 70% discipline is what keeps the company solvent through volatile quarters.) This is genuine operating wisdom and is exactly the kind of thing the product should surface to users at budget-building time.
Quarterly — the strategy reshape. The single most important planning moment after the annual. Revenue conversation, reassessment of the initiative plan, possible pivots in strategy or even in business model. Critical difference from EOS: in EOS, the annual plan is largely fixed for the year, with quarterly Rocks as the only formal adjustment mechanism. That works for operationally-led mid-market businesses with stable models. SAM Plan AI is designed for entrepreneurial visionary-led companies where the business model itself often evolves quarter-to-quarter. (Real example: a visionary-led business that grew from $1.5M to ~$15M over six years did it across roughly four distinct business models — stages/launches, then consulting as the primary driver, then stages again, then events. None of those four was the original starting plan. The annual frame was the scaffolding that let the strategy evolve without losing operational integrity.) The product supports — and expects — quarterly re-strategy, with the framework that makes pivots discipline rather than chaos. This is one of the clearest competitive distinctions from EOS and is worth surfacing in product positioning.
Monthly — the trajectory tune. A larger update than the weekly. Review the month’s results against the quarter’s target. Adjust the next month’s plan. Surface the trends the weekly cadence is too zoomed-in to see. This is where the data flywheel insights most often land — the comparison reveals, the optimization signals, the “you are trending 12% below where you projected this quarter” kind of intelligence.
Weekly — the operating heartbeat. Covered in 1.2. Complete results, see where you are, see what’s moving, adjust if needed, set the top priorities for the week. The cadence that turns a plan into ongoing execution.
Positioning note: EOS-for-revenue is NOT how to describe SAM Plan AI. EOS has defended brand equity around operations; tying ourselves to that model invites comparison (“how is this different from just adding a revenue module to EOS?”) and limits the framing. The honest version is that the SAM planning cadence is informed by EOS but is structurally different — annual baseline/stretch + quarterly re-strategy + monthly tuning + weekly operating loop, all integrated with the data flywheel that EOS does not have. That is not EOS-for-revenue. That is a different category.
2. Product Thesis: Plans → Execution → Outcomes
The single biggest risk to this product is being a plan generator. Plan generation is becoming a commodity — any AI tool can spit out a marketing plan. A plan nobody executes is worthless, and a tool that stops at the plan gets used once and abandoned. The grand-slam version of this product does not sell plans. It sells outcomes, and it earns its price and its retention by driving execution and surfacing when the user is off track.
Three escalating levels of value:
Level
What it delivers
Who can do it
Role in the product
1. Plan
Tells you what to do — initiatives, projections, a project plan.
Commodity. Any AI tool. Table stakes.
The hook. Gets the user to value in 60 seconds.
2. Execution
Turns the plan into projects and tasks and tracks whether they get done.
Few tools connect plan to execution.
The differentiator. Connects strategy to action.
3. Accountability
Surfaces when you’re behind, why, and what to do this week. Drives the outcome.
Almost no self-serve tool does this well.
The moat. The retention engine. Justifies premium pricing.

Design implication: the product must be architected around all three levels from day one — the data model, the core loop, and the vision all assume execution and accountability exist. But v1 builds the minimum viable version of each level, not the maximal one (see Section 13). Grand slam in architecture and vision; disciplined in the v1 build. This is how the product is ambitious without the build ballooning.
Everything Hormozi, Abraham, Cardone, and Dawson would push on traces back to this thesis: price to the outcome (not the tool), drive execution (not just planning), and build the accountability layer that makes the product indispensable rather than a one-time artifact.
3. The Suite Architecture: Planning OS + Growth Modules
SAM Plan AI is not a single product. It is a portfolio of revenue growth tools with the planning OS at the center and focused modules around it — a platform, not a feature list. Each module is its own coherent capability (Stage outreach, Signature Talk Builder, Perfect Product Suite Design, ad strategy, the planning OS itself), and they connect through shared data, shared methodology, and shared customer context. Customers grow into the suite one proven layer at a time.
The pattern this matches: HubSpot’s CRM with marketing/sales/service/ops modules; Notion’s blocks with docs/databases/wikis/projects on top. A strong central piece, modules that connect through it, and an ecosystem far more valuable as a whole than as parts. The long-term moat is the breadth and quality of the modules plus the connective tissue between them.
3.1 The module categories
Ready to productize — existing IP, established methodology:
The planning OS — the core; everything detailed in this spec.
Stage Database + AI outreach — already exists as a static database with email templates; AI-connect it for smart matching, personalized outreach generation, and outcome-fed improvement of both the matching and the database itself.
Signature Talk Builder — Pete and Pat’s workshop methodology, productized; eons of recorded coaching as training data. See 3.2 — this is the most strategically important module.
Perfect Product Suite Design — the offer-ladder framework; helps users design what they sell before / while planning how to sell it. Also the home of the Foundation intake path (3.4).
Established frameworks, more development needed:
Ad Strategy & Optimization — the “grow with ads” module.
Hidden Revenue Surfacer (already on the roadmap, Section 17) — Abraham-style; surfaces money already accessible but not captured.
Emerge later from data and curation:
Industry-specific playbooks (network marketing, coaching, agency, e-commerce, etc.).
Role-specific playbooks (solopreneur, agency owner, CMO / operator).
Stage-of-business playbooks (early-stage, scaling, $1M+, $10M+).
3.2 The Signature Talk as connective tissue
The Signature Talk is more than a module. It is the content layer that feeds every other module. The Signature Talk is the underlying message: what you teach on stages, the through-line in webinars, the angle in the VSL, the hook in the ads, the framing in sales calls. Every initiative in the library uses its content as raw material — different formats expressing the same core message.
Architectural implication: the Signature Talk is a first-class data object alongside the planning OS, the product suite, and the initiatives. A user develops it once and the AI adapts it into webinar scripts, ad copy, podcast pitches, sales-call frameworks, social content, email sequences. That is massive leverage and it is something nobody else is doing. Capture the entity in the data model now even though the full module is v2+ — cheap to design in, expensive to retrofit.
3.3 Architectural principles
The planning OS is the platform. Other modules sit on it and connect through shared data (the customer’s profile, products, initiatives, actuals).
Each module has its own intake, AI logic, templates, and outcome data — but they feed the same central system.
Modules can be packaged and priced individually or bundled — by tier (Pro includes Module X), by role (operator package vs. founder package), by industry. The packaging is a marketing decision; the architecture supports any of them.
The data flywheel that improves benchmarks (Section 16) also improves every module — Stage matching, Signature Talk effectiveness, ad performance — over time. One flywheel, many surfaces.
3.4 The Foundation path — intake routing for users who need pre-planning work
Some users — especially earlier-stage operators — answer “I don’t know” to “who do you serve” or “what do you sell.” For those users, generating a plan would produce garbage. The intake (Section 5) detects this and routes them through the Perfect Product Suite module first. Plan generation opens up to them only after that work is done.
This is not a paywall. It is a competence sequence. Users without a clear offer cannot make a plan; pretending they can would produce confusion that damages trust. So the intake has three routes: Quickstart (users who know what they’re doing and want speed), Full (users who want a tailored plan), and Foundation (users who need pre-planning work). The Foundation route is itself a meaningful product surface — it is where the Perfect Product Suite module earns its keep.
3.5 Build implications for v1
The full suite is a multi-year build. v1 ships the planning OS only (Section 13). The remaining modules are post-v1 and sequenced in the roadmap (Section 17). But three architectural decisions go in now so the suite is not a retrofit later:
The data model treats initiative types, products, and the planning OS as primary entities. The Signature Talk gets a first-class entity in the schema even though the module ships later.
The user profile carries a “marketing signature” field (for the future signature quiz / framework) and a “stage of business” field (for future stage-based playbook routing).
The intake architecture supports multiple routing paths (Quickstart, Full, Foundation) even if only Quickstart and Full are surfaced in v1.
4. Target User
Beachhead (Years 1–2): service-based businesses, coaches, agencies, and info-product companies doing $300K–$10M in annual revenue.
Two buyer profiles inside the same segment. At the lower end ($300K–$2M), the buyer is the founder; they run their own marketing and adopt the product personally. At the upper end ($2M–$10M), the buyer is the operator — the CMO, marketing director, or integrator who runs marketing for the founder. Founders at this size delegate execution; they sell. The product has to serve both buyers, which shapes the product (multi-user roles, team handoffs, role-based dashboards) and the marketing motion (two distinct buyer narratives within the same segment).
The Operators Mastermind IS the GTM motion for the mid-market. Operators inside founder-led $2–$10M companies are both the buyers of the product and the audience the community serves. The mastermind is not just a community feature; it is the sales channel for that segment. Operators talk to other operators about what is working — that is how the product spreads inside the mid-market. The community and the product co-sell.
Design assumption: at the lower end of the beachhead, the user is NOT a marketing expert. The intake must be answerable, alone, in a few minutes — the value proposition is that the product replaces the expert. At the upper end, the user IS a marketing professional with a team; the product’s value is the structure, the benchmarks, and the system that gets their work compounding rather than scattering. The product serves both without forcing either to use the other’s mode.
Expansion path: Year 3+ extends into the $10M–$50M mid-market and eventually enterprise. That move requires real structural shifts — SOC 2 compliance, SSO / SAML, an enterprise sales motion, customer success staffing, procurement-friendly contracts — and is not pursued until the SMB / lower mid-market motion is proven, the team can support it, and the capital is in place. Stay disciplined: expansion is the prize, focus is what earns the right to it.
Operator-buyer note: the operator at the high end of the beachhead lives in GoHighLevel, ClickFunnels, Keap, ActiveCampaign, HubSpot. Meeting them where their data already lives — via platform integrations (Section 17) — is what turns the product from “another tool I have to update” into “the lens I see my real numbers through.” The integration story is what makes the $2M–$10M segment actually adopt and retain at scale.
Retention will likely be asymmetric across the two buyer profiles, and the product roadmap should honor that. The $2M–$10M operator-led segment is the stronger retention engine: operators sit with the product weekly, enter actuals, run the cadence as part of their job. The $300K–$2M founder-led segment is more vulnerable to lapsed engagement — founders sell, they do not operate the tool, and without an internal operator to drive weekly use the product can drift to the side. Founders in this segment will buy (the price point is right, the AI is appealing, Pete’s endorsement carries weight) but year-one retention there could be substantially weaker than in the operator-led segment.
Implications for the build and the projections: (1) the multi-user / team-workflow / role-based features that serve the operator buyer should not be deferred late in the post-v1 roadmap — ship them in v1.5, because they directly support the segment with the strongest retention; (2) revenue projections should model retention separately by segment rather than assuming a blended rate, and the upper-end “Better” and “Best” cases should explicitly attribute the high-retention revenue to the operator-led segment; (3) onboarding for the founder segment needs to be honest about the time investment required and surface team handoff paths early — if the founder has a marketing person or contractor, route them into the product immediately rather than letting the founder be the sole user.
5. The Intake
The intake is the front door to the whole system. It has three routes (see 5.1 and 5.3): a Quickstart path for instant value, a Full path for a tailored plan, and a Foundation path for users who need pre-planning work first. The full intake is seven inputs, presented as six steps (questions 3 and 7 share a screen). In v1, Quickstart and Full are surfaced; the architecture supports Foundation routing for the post-v1 Perfect Product Suite module (Section 3.4).
5.1 Two on-ramps: Quickstart and Full
The central tension of the product: more input means a better plan, but more input also means more friction and more first-session abandonment. Don’t pick one — offer both and let the user choose their depth.
On-ramp
Input
Promise
Output quality
Quickstart
~3 questions (revenue goal, what you sell, what’s worked). AI fills the rest with defaults and benchmarks.
“A real plan in 2 minutes.”
Rough but impressive. Explicitly framed as a first draft.
Full plan
All 7 questions + optional deeper diagnostic.
“The more you tell us, the better this gets.”
Tailored, higher-confidence.

The bridge is the most important design move: the Quickstart plan must visibly show its own gaps, each as an invitation to go deeper, shown at the moment the user can see why it matters (they have a plan in front of them). “This assumes industry-average conversion rates — enter your real numbers to sharpen it.” “We guessed your audience — confirm it to improve initiative selection.” Every gap is a one-click path to a better plan. This funnels users from Quickstart into deeper engagement, which is what drives retention.
Caution: a Quickstart plan is lower quality by definition, and a bad first plan can sour someone on the whole product. The output must be good enough to impress even while rough, and honestly framed as a starting point — “here’s a solid first draft, let’s make it yours,” not “here’s your plan.” Quickstart is in v1; it directly reduces the biggest risk (first-session abandonment).
5.2 The seven questions (Full path)
Question
What the user sees
What it feeds
1. Revenue goal & timeframe
“What revenue are you aiming for, and over what period?” (timeframe selector: 3, 6, or 12 months)
The target the plan works backward from, and how aggressive the initiatives must be.
2. Products & pricing
“Add your products or services, with pricing.” (name, price, one-time or recurring, ticket tier)
All revenue math. Every initiative maps to a product. Recurring vs. one-time changes plan shape.
3. What’s worked before
“Which marketing or sales initiatives have driven real results for you?” (rich input)
Which initiative types the AI weights toward. The question that makes the plan feel like it knows the business.
4. Ideal customer
“Describe who you’re trying to reach.”
Initiative-type fit and the conversion benchmarks the projections use.
5. Current assets
“What do you already have? Email list size, social following, website traffic, existing customers.”
The realism ceiling on projections. Sets what’s achievable in the timeframe.
6. Budget & team
“What’s your monthly marketing budget, and who’s on your team?”
Feasibility filter (no $50K ad plans on a $3K budget) and sizes the project plans. Also drives difficulty-matching (Section 6.2).
7. Obstacles
“What’s held you back, or what hasn’t worked? Anything you’ve tried that flopped.”
Negative constraints — tells the AI what NOT to recommend. The guardrail against generic best-practice slop.

Design note: Questions 3 and 7 are two sides of one coin — what’s worked and what hasn’t. Present them together as one reflective moment (“tell us about your wins and your struggles”) so the intake feels like six steps, not seven. Spend disproportionate design energy on Question 3; the richer that answer, the better the plan.
5.3 The Foundation path
Some users — especially earlier-stage operators — answer “I don’t know” to “who do you serve” or “what do you sell.” For those users, generating a plan would produce garbage. The intake detects this and routes them through the Perfect Product Suite module first (Section 3.4); plan generation opens up only after that work is done. This is not a paywall — it is a competence sequence. Users without a clear offer cannot make a plan; pretending they can would produce confusion that damages trust.
In v1, the intake surfaces Quickstart and Full; the Foundation route is architected for the Perfect Product Suite module, sequenced for Q3 2027 (Section 17).
5.4 Progressive depth
The seven questions are the floor, not the ceiling. After generating the first plan, let users optionally go deeper — more detail on their product suite, team, or what’s currently running — to get a more rigorous plan. The casual user stays at seven questions; the serious user can provide audit-level detail and get an audit-level plan. This is how one product serves both “the solo coach who wants a quick plan” and “the $2M business that wants real rigor.”
5.5 Edit after generation
Generate the plan first (the magic is the instant first draft), then let the user swap, remove, or add initiatives (the ownership comes from adjusting it). The intake gets them to a plan in 60 seconds; the editing makes it theirs.
6. The Initiative Library
An initiative is what the business does — “Q2 retention webinar series,” “spring email nurture campaign,” “LinkedIn outbound to agency owners.” It is the unit the user plans, schedules, and executes. An initiative runs through an underlying channel, which determines its conversion math and project template. The user thinks in initiatives; the engine knows the channel underneath.
There is no fixed cap on the number of initiative types. The real constraint is depth-per-initiative.
6.1 Every initiative type needs three things
An initiative type without all three is just a label, and a label produces vague projections and empty project plans — worse than not offering it at all.
Conversion benchmarks — the math (conservative / moderate / aggressive rates).
A project template — a real task list with sequencing, roles, and durations.
AI context — enough guidance that the generator knows when to recommend it and how to size it.
6.2 Difficulty / level of effort (four dimensions)
Difficulty is not one number — an initiative can be hard in different ways, and conflating them loses information the AI needs to match initiatives to the user. Capture four distinct dimensions per initiative type:
Dimension
What it measures
Example range
Effort to implement
How much work it is (roughly total task-hours from the template).
Referral ask (low) → multi-day summit (very high).
Skill / expertise required
Can a solo non-marketer do it, or does it need real skill?
Email (approachable) → paid ads done well (high skill).
Time to results
How fast it pays off.
Webinar to warm list (fast) → SEO / organic content (slow).
Cost to run
Money required, separate from effort.
Organic content (cheap, slow) → paid ads (costs money fast).

Why four dimensions, not one: the AI generator matches initiatives to the user’s actual situation from the intake (budget, team, assets, timeframe). A solo operator with no budget and 3 months gets low-effort, low-skill, fast-result initiatives. A business with a team, budget, and 12 months can be handed harder, slower, higher-ceiling ones. A single blurry “hard/medium/easy” score can’t support those tradeoffs; four dimensions can.
UI: surface this simply — an effort indicator and a “you may want help with this” flag on each initiative — while the AI uses the full four-dimension version underneath. The high-difficulty / high-skill initiatives are also exactly where add-on services are offered (Section 14.3): “this one’s powerful but hard to do alone — want help?”
6.3 Tiered rollout
Tier
What
When
Tier 1
Core initiatives for the beachhead, fully built (benchmarks + templates + AI context).
Build first. Launch v1 with these. ~8–12 types.
Tier 2
Next wave — summits, podcasts, masterminds, workshops/local stages, affiliate, PR, direct mail.
Add over time, validated by demand. Build properly when added.
Tier 3
Long tail — rare/specialized (charity events, dinner experiences, association trainings, 360 virtual events).
May use a generic template + AI-generated tasks rather than hand-built.

Suggested Tier 1 launch set
Webinar, email campaign, challenge / bootcamp, paid ads, VSL / sales page, sales calls, content & organic social, referral. These cover roughly 90% of what the beachhead actually uses. Confirm against your own benchmark data before locking.
6.4 Build initiative types as DATA, not code
Store each initiative type as a structured record — benchmarks, template tasks, AI prompt context, the four difficulty dimensions — that the app reads at runtime. Then adding a new initiative type is a content task (filling in a structured form), not an engineering task. This is critical: the initiative definitions are the part of the product only you can write — your launch experience encoded. Do not let that be bottlenecked behind code changes. Make it something you can add and refine as fast as you can think it through.
6.5 Future dimension: Own vs. Ops
The same initiative behaves differently on the business’s own platform (own list, own audience, own stage) versus a borrowed one (ops — someone else’s podcast, stage, summit, audience). A webinar to your own list has different economics and a different project plan than guesting on someone else’s. Do NOT surface this in v1, but include an Own/Ops flag in the data model so it can be added later without re-architecting. This distinction is how the product will eventually outclass generic tools — it reflects how growth is actually run at scale.
6.6 Initiative types: one-time, recurring, and evergreen
Every initiative is one of three types, and the type determines how it is anchored in time, how it renders across the planning horizons (Section 1.3), and when it leaves the active view. The dividing line is not “happens once vs. happens repeatedly.” It is whether the initiative resolves to a completion or runs as a state.
One-time — a live event with a fixed date: a live webinar, a product launch, a summit. It resolves. The date arrives, the event happens, and it is done. It moves through terminal states (planned → in progress → done), then exits the active view.
Recurring — a repeating series of one-time events (“two flagship webinars per quarter”). Modeled not as its own rendering type but as a generator: a template that spawns one-time instances, each with its own date, prep tasks, and results. Recurring reuses every piece of one-time logic and never needs separate rendering code.
Evergreen — an always-on initiative with no terminal condition: an evergreen webinar, an always-on VSL funnel. It runs as a state (setup → active → paused → retired), is measured by run-rate or trend rather than a single result, and never reaches “done.”
The generator model is the load-bearing architectural decision. One-time and evergreen are the two primitives; recurring is not a third. A recurring template carries the event schedule (e.g. 2× per quarter) and a promo offset, and each instance it spawns is identical in shape to a standalone one-time initiative. The payoff: all rendering, visibility-gating, and metric logic operates on one-time instances with no special case for “this came from a recurring parent.”
Date anchors
Each type has an activation date — the moment the initiative becomes active and visible in the plan. The dated types add a second anchor, the event date, which closes the active window and resolves the initiative.
Evergreen needs a launch date. It runs open-ended from that date; there is no event date.
One-time needs a promo launch date and an event date. The promo launch date opens the active window (the promotion and run-up); the event date closes it. After the event date, the initiative exits the active view.
Recurring needs an event schedule and a promo offset stored on the template (e.g. “promo opens 21 days before each event”). Each spawned instance computes its own promo launch date as event date minus promo offset — so adjusting the offset updates every future instance automatically, and no promo date is ever hand-entered per instance.
The launch date (evergreen) and the promo launch date (one-time and recurring) are the same structural role: the activation anchor that gates visibility. Before it, the initiative does not clutter near-term horizon views — a November webinar should not appear in a June week-view. After it, the initiative becomes active and begins to ramp. In the data model, treat them as one field doing one job; only the UI label differs.
Rendering across the horizons
The type determines how an initiative appears as the operator zooms from the annual frame down to the daily view:
One-time morphs. At the year level it is a single marker in one period; the deeper the zoom, the more it becomes the run-up — prep ramping, a countdown — until the event day. After the event, it is gone.
Recurring multiplies, then collapses. Many instances across the year, narrowing to a couple per quarter, to one-plus-prep in a month, to a single task today. Every appearance is a one-time instance rendered by the logic above.
Evergreen persists. It is the same continuous presence at every horizon; what changes per horizon is only what is measured — the run-rate at the month level, the upkeep task at the week level. It never belongs to a single period and never disappears.
Build note: this is why a one-time and an evergreen initiative must be queried differently when populating any horizon view. The one-time query is “does this period contain the event date, or fall inside its promo/prep window?” The evergreen query is “does this period fall between the launch date and retirement?” One query shape cannot serve both — a shared query will either drop evergreen items out of periods they belong in or persist one-time items past their event date. Two query shapes, keyed off the initiative type.
7. Conversion Benchmarks
The benchmark library is the moat. Each initiative type has conservative, moderate, and aggressive conversion rates that drive the Good / Better / Best revenue scenarios automatically.
Requirement: benchmarks must be defensible, not invented.
Example fields by initiative type: a webinar needs registration rate, show-up rate, and offer-conversion rate; PPC needs CTR, conversion rate, and cost-per-click; email needs open rate, click-through rate, and conversion. Each initiative type defines its own input fields and benchmark set.
7.1 Sourcing hierarchy
Where the data comes from matters as much as what it says. Use sources in the order below — cleanest and most defensible first.
Source
What &** how**
Moat &** exit value**
First-party (us)
Every launch Rachel, Pete, and the team have run. Consolidate into a structured benchmark capture template now. Backfill what’s in memory; capture every new launch going forward.
Highest. Owned outright. The single best seed for the product.
Partner-shared
Operators in the roster who share anonymized launch data in exchange for value (early access, founding cohort, benchmark report).
High. Consensual, anonymized, attributable to a credited cohort. Defensible at exit.
Published benchmarks
HubSpot, WordStream, ON24, ConvertKit, ClickFunnels, industry reports. Two–3 credible sources per Tier 1 initiative, properly cited.
Floor. Everyone has access — doesn’t differentiate — but legally clean and useful for v1 before first-party data is fully indexed.
Bought industry reports
Statista, IBISWorld, Forrester, eMarketer for specific verticals. $500–$5K per report.
Useful once you know which verticals to invest in. Buy targeted, not broadly.
Web scraping / data brokers
Avoid. Gray-area or worse. Reputational and legal risk; will be flagged at exit diligence.
Negative — can blow up an acquisition. Stay off.

7.2 The exit lens
Since the company is being built toward an eventual exit, the data asset will be scrutinized in diligence. Acquirers will ask: where did this data come from, do you have the right to use it commercially, can users opt out and is that respected, is it anonymized, what’s your privacy paperwork, has there been misuse. Clean answers to every question raise the multiple; unclear answers discount it. The cost of doing this right early is small; the cost of cleaning it up later (or having the deal discounted) is enormous. Document sources, consent, and anonymization from day one.
7.3 The internal benchmark capture project
Before any of the partner outreach, formalize the internal effort: sit with Pete and pull what’s in his head onto paper. Do the same with Rachel’s memory and the team’s. Build a structured template (Airtable / Notion / spreadsheet — consistency matters more than the tool) where every historical launch gets logged with key metrics and circumstances. Two-week to one-month project. This becomes the seed of the benchmark library and the foundation everything else builds on. Pete is good at carrying numbers in his head; the project is moving them into a system.
8. Project Plans & the Execution Layer
This section is where the product stops being a plan generator and becomes an outcome engine (Section 2). It has two parts: the project plans (turning initiatives into tasks) and the accountability layer (driving and tracking whether those tasks get done).
8.1 Project plans are template-based
Each initiative type has a canonical project template — a real task list with sequencing, roles, dependencies, and durations. When a user creates an initiative and clicks “generate project,” the template instantiates.
Option
Behavior
When to build
A
Literal template, unchanged. User customizes after.
Build first (simplest).
B
Template merged with the initiative’s specifics — task names personalized, dates auto-populated from the initiative’s start date.
Ship in v1. This is where the magic lives.
C
Template + AI personalization — task names, timing, and task list tailored to initiative size and context.
Add later as a pro-tier feature.

Two things most planning tools botch
Lead-time logic. Tasks must be defined relative to the launch date (“this happens N days before launch”), not as absolute weeks. A webinar going live June 1 needs the registration page live by May 1, first email May 8, etc. Otherwise users re-date everything manually every time.
Honest task sizing. Use realistic durations pulled from actual execution experience (“design slides: 6–10 hours over 5 days,” not “1 hour”). Unrealistic estimates destroy trust in the whole product within minutes. This is another place your first-party experience is a differentiator competitors can’t fake.
8.2 The accountability layer — a maturity curve
Accountability is the moat (Section 2, Level 3). Build it as a three-level curve where each level is built on the data and logic of the one below it. Architect Level 1 cleanly — so the system always knows the state of every task and every actual-vs-plan number — and Levels 2 and 3 become additions, not rebuilds.
Level
What it does
Build when
Cost
1. Passive
Shows the user where they stand: what’s due, what’s done, where they’re behind, actuals vs. plan. User must log in to see it.
v1 (light version).
Cheap — a view over existing task/actuals data.
2. Automated check-ins
Product reaches out. Email/SMS nudges on a cadence: “3 days to launch, 4 tasks open” / “tracking 12% behind — focus here.”
Fast follow (v1.5).
Moderate — a notification engine + trigger rules on Level 1 data.
3. Agent check-ins
An AI agent has the accountability conversation: reasons about the situation, adjusts the plan, problem-solves, escalates to a human only when needed.
Later. Same capability as “Ask Pete” and AI onboarding.
Higher — but trained on the human check-ins you run early.

Pricing insight: the accountability level can BE the pricing tier. Passive for Starter, automated check-ins for Pro, agent-driven (plus human reviews) for Mastery. The price jump between tiers is not more features — it is more accountability, i.e. a higher probability of hitting the number. That is outcome-based pricing.
Caution: automated and agent check-ins must be GOOD or they are worse than nothing — a wrong, mistimed, or annoying nudge trains people to ignore the product and then cancel. Do the human version first (Level 1 + your own check-in calls in the launch phase), learn what a genuinely useful nudge is, then automate. The launch-phase human calls are accountability research as much as onboarding research.
8.3 Per-initiative budget and spend (the finance layer)
Revenue is only half of an initiative. A webinar that drives $50K on $2K of spend and a paid-ads push that drives $50K on $40K of spend are not the same plan, and an operator deciding what to run next needs the net, not the gross. So the product tracks cost per initiative, not just revenue. Because the data model, the projections, and the actuals are all being built revenue-first right now, the cost dimension must be designed in now even though the rich version ships later — retrofitting profit math onto a revenue-only model is exactly the kind of rebuild this spec exists to avoid.
What this is NOT: a general ledger. Full accounting is what the QuickBooks / Xero integration is for (Section 17, 2028), and it stays out of scope until then. The finance layer here is initiative-level: planned budget, actual spend, and the net and ROI that fall out of pairing spend with the revenue already tracked.
Build it on the same maturity curve as accountability (Section 8.2), so each level is cheap once the level below it exists:
v1 — capture and view (light). Each initiative carries a planned budget. In the weekly “complete results” step (Section 1.2), the user enters actual spend alongside actual revenue for active initiatives. The Level 1 passive view then shows spend vs. budget next to revenue vs. plan and derives net and ROI per initiative. This is a small addition to a capture flow and a view that already exist.
v1.5 — budget alerts (accountability Level 2). The same notification engine that nudges on revenue (Section 8.2, Level 2) also watches the money, with two trigger types. Spend pace / overrun: an initiative or the portfolio is burning budget faster than planned, or projected spend will exceed the budget before the event. Revenue-miss → budget adjustment: when revenue tracks behind plan, the prudent response is to pull spend back, not hold it. This is the live expression of the 70%-of-baseline discipline (Section 1.3) — “Revenue is tracking 15% behind plan for Q3; committed initiative spend now exceeds the prudent envelope, consider trimming [X].” The alert recommends the budget move that keeps the company solvent through the miss, rather than only reporting the miss.
Later — automatic spend (with the integrations). Once GoHighLevel and the ad platforms are connected (Section 17), ad spend and campaign cost flow in without manual entry, and the QuickBooks / Xero capstone makes the finance layer accounting-grade. Manual entry is the v1 seed; the integrations remove the friction over time.
Flywheel note: cost actuals are a second benchmark stream alongside conversion rates. What a webinar actually costs to run, typical CPA by channel, real cost-to-revenue ratios — data no published benchmark source has at this granularity. It makes the data flywheel (Section 16) harder to clone on the cost side, not just the revenue side. Capture it cleanly from the start.
9. Data Model
Sketch this before prompting any AI builder. If the model is coherent, the build will be coherent. Core entities:
Entity
Key fields
Notes
Company
name, fiscal year, planning year, currency, prior-year revenue, target revenue, budget, customer description
The root record. Holds the gap (prior vs. target).
Product
name, price, recurring vs. one-time, ticket tier (low/mid/high)
Initiatives map to products. Tier drives ladder balance.
InitiativeType
name, channel, benchmark set (cons/mod/agg), input fields, project template, AI context, 4 difficulty dimensions (effort/skill/time-to-results/cost), Own/Ops flag, owner (system vs. user)
STORED AS DATA. The library. Adding one = content task. Owner flag enables customer-created initiatives (Section 16.5).
Initiative
name, linked product, initiative type, kind (one-time / recurring / evergreen), traffic input, activation date (promo launch for dated types; launch for evergreen), event date (dated types only), status, generated Good/Better/Best revenue, planned budget, actual spend (net and ROI derived)
The unit the user plans and executes. Kind drives date logic, horizon rendering, and terminal-vs-state behavior (Section 6.6).
RecurringTemplate
linked initiative type & product, event schedule, promo offset (relative), spawned instances
Generator for recurring initiatives (Section 6.6). Spawns one-time Initiative instances; each instance resolves promo launch date = event date − promo offset.
Projection
rolled-up revenue by month / quarter / scenario / product
Derived from initiatives.
Project
linked initiative, status, owner, start/end dates, budget
Instantiated from the initiative type’s template.
Task
project, name, status, priority, assignee, due date (lead-time derived), est/actual hours
From the template; dates calculated from initiative start.
Actuals
monthly actual revenue by product; actual spend by initiative; variance vs. projection and vs. budget
Feeds accountability and the finance layer (Section 8.3). Revenue and spend captured together in v1 (light).
Expense
linked initiative, category, amount, date, source (manual / integration)
Per-initiative cost line items. v1 needs only a planned budget + actual spend per initiative (fields on Initiative); itemized Expense rows are the richer option and the shape integrations write into later.
Partner
name, referral/affiliate code, attributed signups, attributed revenue, payout terms
Distribution leverage. Attribution hook in v1; full portal later.
CheckIn
user, trigger (task overdue / behind plan / pre-launch / budget overrun / spend pace / revenue-miss budget adjustment), channel, message, sent date, response
Powers the accountability layer (Section 8.2) and budget alerts (Section 8.3). Schema in v1; automated sends in v1.5.

Accountability is largely derivable, not a new data silo: “on track vs. behind” comes from Task status + due dates + Actuals vs. Projection. Build those cleanly and the check-in logic has everything it needs.
10. AI Initiative Generator
The generator is the productized judgment of an expert: look at a business and decide which initiatives will actually work for it.
Input: the seven intake answers.
Output: structured JSON — 6–10 initiatives, each with a product mapping, initiative type, start/end months, and expected traffic/volume.
Core skill is selection: pick the right 6–10 from a library of many, based on goal, audience, assets, budget, and what’s worked. A plan with 30 initiatives is not a plan.
Match difficulty to the user (Section 6.2): weigh each initiative’s effort, skill, time-to-results, and cost against the user’s team, budget, expertise, and timeframe. A solo operator with no budget and 3 months should not be handed a multi-day summit.
As the library grows, selection intelligence matters more — and “the AI picks the right initiatives for you from everything possible” is a stronger story than “here are your eight options.”
Implementation: call the Anthropic API with a system prompt that defines the available initiative types and instructs the model to return ONLY structured JSON matching the Initiative schema. Parse and slot directly into the data model. This is genuinely one of the easier parts to build — it is a well-specified prompt returning structured data.
11. Unit Economics
Model these before you build. The revenue projections are top line; this is the cost structure underneath, per customer. Without it, you can hit your revenue target and still lose money — especially on the labor-backed Mastery tier. Eat your own dog food: the SAM Plan business should model its own plan in its own product.
11.1 Metrics to model, per tier
CAC (customer acquisition cost) by channel — especially partner/affiliate vs. paid vs. organic.
LTV (lifetime value) by tier — driven by price × retention. The accountability layer is the lever that raises retention and therefore LTV.
Gross margin by tier — revenue minus cost-to-serve. Starter and Pro are software-margin (high). Mastery is labor-backed.
Cost-to-serve — the real one. Mastery includes 3 reviews/year of Rachel’s (or a reviewer’s) time. Price that time in. A $4,997 tier that consumes 6 hours of expert time may have a worse margin than $149 Pro.
Payback period — how many months of subscription to recover CAC. Annual plans and the launch package shorten this dramatically.
11.2 The Mastery margin flag
The highest-priced tier may be the lowest-margin one because it is backed by human time, not software. This is not a reason to drop it — it funds development and produces the deepest learning and best testimonials early — but it must be modeled honestly and the human work must have a path to scale (certified reviewers, then agent-assisted review). Watch this number as you grow.
12. Tech Stack
Layer
Tool
Role
Build / app
Lovable
Vibe-code the app; non-dev friendly; GitHub two-way sync for later hardening.
Database / auth
Supabase
Data persistence and user accounts (wired into Lovable).
Billing
Stripe
Subscriptions, checkout, dunning, customer portal.
AI
Anthropic API
Initiative generation; structured JSON output.
Video
Wistia
Training and replay hosting (clean, no suggested-video distractions).
Live calls
Zoom Webinar
Monthly Pro-tier live training + Q&A; auto-recording.
Community
TBD
GoHighLevel / Skool / other — decision deferred; not blocking the build.

13. Build Sequence (v1)
Build the core loop with a tightly scoped MVP. Do not build all of the documentation’s Phase 1 at once. Grand slam in architecture; disciplined in build — v1 includes the MINIMUM viable version of execution, accountability, and partner attribution, not the maximal one.
v1 scope (in)
Quickstart on-ramp (~3 questions → instant rough plan) plus the full 7-question intake, with gap-driven prompts bridging Quickstart to Full
AI initiative generator (returns structured initiatives), with difficulty-matching to the user’s situation
Tier 1 initiative library (8–12 types) with benchmarks + templates + the 4 difficulty dimensions
Good/Better/Best revenue projections
Template-based project plans (Option B — merged with initiative specifics)
Level 1 (passive) accountability — a “what’s due / where you’re behind” view over tasks; light actuals entry
Per-initiative planned budget + actual spend capture, with spend-vs-budget in the passive view (finance layer v1; budget alerts ship v1.5 with accountability Level 2)
Partner attribution hook (referral codes + tracked signups)
Accounts, data persistence, subscription billing
Explicitly OUT of v1
Automated check-ins (Level 2) — fast follow, v1.5
Agent check-ins (Level 3), “Ask Pete,” AI onboarding
Full actuals/variance analytics
Own/Ops dimension (schema only, no UI)
AI-personalized project tasks (Option C)
Full affiliate portal & multi-tier payouts
Multi-user collaboration, advanced analytics
Suggested week-by-week
Phase
Work
Before code
Write the Tier 1 initiative definitions (benchmarks, templates, AI context). Source and document benchmarks. Sketch the data model on paper.
Build week 1
Static prototype, hardcoded test data: intake form + projection table + output page. Prove the math and the story. No AI, no DB.
Build week 2
Wire in the Anthropic API for the initiative generator. Structured JSON into the data model.
Build week 3
Supabase auth + persistence so users can save plans. Project-plan instantiation from templates.
Build week 4
Stripe subscription layer: checkout, webhooks, customer portal, cancellation flow.
Validate
Put it in front of 5 real businesses (not network marketers). Run your own businesses through it as the gut-check.

14. Offer & Subscription Tiers
14.1 Offer philosophy
Sell the outcome, not the tool. The entry offer should be risk-reversed enough to be almost uncomfortable — a strong guarantee tied to a concrete result (e.g. “build your plan and have a clear, executable path to your revenue goal, or your money back”). Price against the value of the outcome (the revenue the plan helps produce), not the cost of the software. A 14-day trial is table stakes, not an offer.
Ascension path: the subscription is the front end, not the whole business. Map the next sale — done-with-you implementation, certification, higher-touch advisory, events, an agency referral. A planning tool that becomes the trusted planning partner has a back end worth more than the subscription. Define what a happy Pro customer buys next.
14.2 Tiers
Tier
Price
Includes
Starter
$49/mo · $490/yr
Core SAM Plan tool, AI generator, project templates, 1 company / 1 user.
Pro
$149/mo · $1,490/yr
Everything in Starter + monthly live training & Q&A, community, multi-user, advanced features.
Mastery
$4,997/yr (capped ~50)
Everything in Pro + 3 plan reviews/year, priority hot-seat access, direct support channel.

Billing notes: annual discount ~15–20% (not 50%); 14-day full-feature free trial (not freemium — the AI generator costs real money per use); turn on Stripe Smart Retries and dunning; build a clean self-serve cancellation flow; use Stripe’s customer portal for plan changes; set a clear refund policy (30-day money-back, none after).
Launch-package option: a one-time $497–$997 package (12 months of access + a workshop) sells well to an audience conditioned to buy programs rather than subscriptions, and front-loads cash to cover build and marketing.
14.3 Add-on products & services
The product identifies what a business needs to do; some businesses will want help doing it. That makes services a natural, non-forced upsell — it solves a problem the product itself just surfaced. The categories map to where users get stuck:
Add-on
Solves
Triggered when…
Coaching / advisory
“I have the plan but want guidance executing it.”
Overlaps with Mastery reviews + the accountability layer.
Done-with-you / done-for-you
“I don’t have the time or skill to build this.”
The plan is heavy on high-effort / high-skill initiatives (Section 6.2).
Product creation
“My plan needs a mid-ticket offer I don’t have yet.”
The product ladder has a gap (see Tiers section).
Tech help
“I can’t wire up the page / automation / pixels.”
Tasks require technical skill the user lacks.

The strategic beauty: the product’s own output tells you which add-on to offer each user. A plan heavy on paid ads (high skill) for a solo operator with no marketing expertise → surface “want our team to run these?” Add-on recommendations become AI-driven and contextual, not generic upsells — the difference between feeling helpful and feeling sold to.
Reframe: the product is the lead-and-diagnostic engine for a productized consulting and coaching tier above the subscription. Every paying subscriber is a pre-qualified prospect with a known problem profile. The data flywheel tells us, in real-time and across thousands of businesses, exactly what is stuck and exactly what the fix pattern looks like. That signal converts to higher-touch offers no generic consultant or coach can match:
Targeted coaching offers. “Your offer conversion is in the 20th percentile — here’s a 3-session intensive on offer design” lands harder than a generic coaching pitch because the user already trusts the data.
Productized consulting engagements. Defined scopes triggered by specific data patterns: “Your launches convert but retention is dropping” surfaces a retention engagement. “Your team produces initiatives but doesn’t finish them” surfaces an ops engagement. Each engagement is scoped, priced, capacity-limited.
Campaign playbook access (the premium IP tier). The deep versions of the campaign playbooks (Section 17) — book launch, event fill, course launch, webinar fill, with all the tweaks and proven structures — are gated behind this tier. The base subscription gives users the planning OS and the meta-structure of the playbooks; the upgrade gives them access to the maintained, deep, segment-specific playbook library plus the people who help them run it. The Pete+Rachel methodology that produced Eric Worre’s 40K+ book launch (vs. comparable launches at half that) is exactly the kind of uncommon expertise that justifies premium pricing. Protects the IP, creates a clear upgrade path, and makes the customer’s investment a function of the value at stake (a $500K book launch deserves a different price than a $5K webinar).
Strategic advisory at the upper end. For $5M+ businesses where the data flywheel surfaces strategic patterns (consistent under-pricing, missed expansion opportunities, capacity ceilings), the upsell is Pete/Rachel-level advisory at premium rates. Small in volume, large in margin.
Group programs and cohorts keyed to data patterns. The Operators Mastermind plus future segment-specific variants: a “fix your offer ladder” cohort, a “scale your launch motion” cohort, an “agency owner growth” cohort. The data tells us which cohorts to run; the existing community infrastructure delivers them.
Unit-economic implication: the actual customer LTV is meaningfully higher than the subscription-only number. Pure SaaS LTV at $1,200/year blended ARR is the floor. If 15–20% of customers upgrade into a higher-touch offer averaging $5K–$50K per engagement, true LTV is 2–3x the subscription number. This is the model that operator-led businesses (HubSpot Academy + services, Salesforce + Trailhead, etc.) all converge on. It is structurally harder to compete with than either software-only or consulting-only.
Discipline to hold: the consulting/coaching tier is productized — defined scopes, defined prices, defined delivery (usually by someone other than the founders), capacity-limited. Not an open-ended “Rachel and Pete will consult with anyone who asks” business. That open-ended version is the exact trap that destroys focused companies. The DFY arm (Section 14.4) and the certified-operator network are the delivery mechanisms; the founders set the standard and protect the curator role.
Two cautions. (1) Delivering these services is a whole separate business with its own operational weight — people, QC, scheduling, fulfillment (the Dawson concern). Architect the product to surface and route to add-ons from the start, but treat actual delivery as a deliberate, later expansion so it doesn’t recreate the founder-as-bottleneck trap. (2) Strongly consider a marketplace model over in-house delivery: connect users to vetted providers (coaches, agencies, freelancers) and take a referral / marketplace cut. Asset-light, scales without founder time, turns the roster and network into supply, and is the natural home for the certified-partner directory. Decide marketplace-vs-in-house deliberately — it is a real strategic fork.
14.4 In-house DFY arm — deliberate small premium asset
Separate from (and in addition to) the marketplace / certified-operator network: a small, deliberate in-house DFY agency that the founders own and that operates as a strategic instrument, not a revenue maximizer. The case for it is intelligence-driven: a certified network gives reach, but it doesn’t give ground-truth on what’s actually happening inside engagements. After a year, you’d be updating the playbook from second-hand reports rather than direct experience. A small in-house arm keeps the team — and the founders — fresh on real engagements, finding what’s broken in the playbook and feeding it back into the system. Dogfooding as R&D, with revenue attached.
The case (real, but conditional)
Continuous insight loop — your own people doing the work, hitting edge cases, surfacing what the playbook misses. The qualitative complement to the data flywheel.
Margin-rich premium revenue — high-touch implementation against established methodology, with strong pricing power.
Credibility flywheel — named case studies, reference customers, “the founders’ team delivered this” stories that benefit the software and the certification network.
Strategic hedge — if software takes longer to scale than planned, the DFY arm pays the bills and keeps the lights on.
The trap (just as real)
Service businesses have a gravitational pull on founder attention that software doesn’t — because services have clients with crises. The worst version of this arm is the one where Rachel said “I’ll hire someone to run it” and 18 months later is spending half her week on agency emergencies. The history is honest: an agency was acquired, then another was run until 2025, with the explicit recognition that the founder is better at synthesis than implementation. Building a fresh agency — even with someone running it, even on top of a category product — is structurally a pattern already lived twice. The question to ask honestly: do you want to own this, or do you want to want to? They are different commitments.
Architectural constraints — non-negotiable if it happens
Hire the lead BEFORE the first engagement. Not after revenue comes in; before. A real operator with experience running a 20–50 person agency. They have full P&L and operational authority. The founder does not own delivery, ever.
Capacity-constrained by design. 10–15 active engagements maximum, with a waitlist. This is not a growth business; it is a strategic instrument. Demand pressure justifies premium pricing.
Premium-only positioning at a meaningful multiple of the certified-operator average. Branded distinctly (“Worre / Stivers Studio” or similar). Direct access to the originators, used only for select engagements. Do not cannibalize the certified network on price.
Intelligence loop built into the lead’s job description: every engagement produces documented learnings that flow into the playbook. This is the structural reason to run it. Without the loop, you have an agency. With it, you have R&D that produces revenue.
Refuse to be the safety net. When something goes wrong and the lead asks the founder to step in, the answer is “what do you need to handle it without me.” Always. Every save is a vote for the pattern returning. This discipline protects the curator role.
The fork
Two non-negotiable conditions for proceeding: (1) the operational lead is hired and in place before the first engagement, with real authority; (2) the arm stays small and premium by deliberate design. If both are real, this is a great asset. If either wobbles — “but what if a great client comes along that needs more?” “what if the lead leaves and we need to bridge?” — then kill the in-house DFY and rely on certified operators for the intel via structured reporting. The decision is not “should we have one” but “are we structurally capable of having one without being consumed by it.” Decide honestly. Then write the constraints into the company’s own constitution.
15. Onboarding, Retention & Stickiness
The riskiest moment for a planning tool is the first two weeks: a user builds a plan, gets the artifact, and never returns. Three time horizons solve three different problems: onboarding gets them to value fast (retention in weeks 1–4); the weekly cadence keeps them there (retention in months 2–12); the stickiness model — activation metric, milestone insights, and the Monday-morning hook — is what makes the habit form rather than just permit it.
15.1 Three layers of onboarding
Layer
What
Who / when
Cost &** scaling**
In-product onboarding
Guided first-plan walkthrough: prompts, tooltips, a checklist, a short founder Loom per step. Drives toward the activation metric (16.5), not just to a finished plan.
Everyone, always. Non-negotiable baseline.
Build once, serves all. Scales infinitely.
Group onboarding call
Recurring (weekly/biweekly) live session: build a plan live, answer questions, meet other new members.
Any Pro+ member. The scalable workhorse; doubles as community.
One call serves many. Same Zoom Webinar setup as monthly training.
1:1 onboarding call
Personal call to build the user’s first plan with them.
Launch phase: done personally, prioritized (see 17.2). Steady state: Mastery perk + annual incentive.
Expensive, scales poorly. Cap volume; taper over time.

15.2 The 1:1 calls are an early-stage research tool
In the first ~90 days, every 1:1 onboarding call is the richest product intelligence available — where people get confused, which AI recommendations miss, what language they use (gold for marketing copy), why they would or wouldn’t renew. The retention benefit to the customer is real, but the learning benefit to the founder is the actual reason to do them early. This means they have a time dimension, not just a tier dimension:
Launch phase (first ~90 days / ~50–100 customers): offer 1:1 calls personally, capped (e.g. 5–8/week). Prioritize annual payers, higher tiers, and at-risk users (signed up but no plan built). Offer via a booking link so motivated users self-select and volume stays capped.
Steady state (once patterns repeat): 1:1 calls retract to Mastery tier and to the annual-upgrade incentive. Everyone else gets in-product onboarding + the group call. The product’s own onboarding now does the job the calls did.
This taper is deliberate. Do the calls intensely early because they are high-learning and build the first cohort of case studies and testimonials; graduate to the scalable version once the lessons are extracted. Documenting it as a taper protects against the trap of feeling obligated to do 1:1 calls at 300+ customers.
15.3 Onboarding as an annual-upgrade incentive
A 1:1 (or priority group) onboarding call is a genuine reason to choose annual over monthly: “Pay annual, build your first plan with an expert.” It front-loads cash and the annual commitment itself improves retention. Use the call as a lever for annual conversion, not as a blanket offer to every monthly signup — the blanket version recreates the time-trap.
15.4 The real retention engine
Onboarding calls treat the symptom (slow start). The disease is a product that doesn’t pull people back after the plan is built. The durable fix is the weekly rhythm — actuals tracking, the live training, and the community. A user who logs in weekly to see real-vs-plan doesn’t need a call to stick. Calls are the bridge; the weekly rhythm is the destination. Do not let high-touch onboarding substitute for building the weekly rhythm into the product.
15.5 The activation metric
Every successful subscription product has one specific behavior that, once a user crosses it, makes them dramatically more likely to stick. Facebook: 7 friends in 10 days. Dropbox: 1 file on 1 device in 1 day. Twitter: follow 30 accounts. Slack: 2,000 messages in a team. The product’s job in week one is to drive every user across this threshold as fast as possible.
Hypothesized activation metric: ENTERING ACTUALS AGAINST THE PLAN FOR THE FIRST TIME.
Until they do this, the product is theoretical — a plan they made. After they do it, it’s real, the weekly loop has a chance to grip, and the product transitions from “tool I tried” to “tool I’m running my business with.” This is the same psychological flip as the Facebook/Dropbox examples: they commit their real stuff to the product.
Design implication: onboarding ends when they’ve seen real-vs-plan, not when they’ve built a plan. Walk them through entering their first actual (even just last month’s revenue) as part of onboarding. Don’t let them leave the onboarding flow without that view. Instrument the metric from day one — measure how many users hit it, in what timeframe, and how many of those retain at month 3 vs. those who don’t. Validate or replace the hypothesis with real data within 90 days of launch.
15.6 Milestone insights — self-discovery, not badges
The wrong gamification for this audience is badges, points, confetti, and XP — patronizing to a 45-year-old running a $500K coaching practice. The right gamification is what WhisperFlow does: each meaningful milestone unlocks an INSIGHT only the product can reveal. Self-discovery as reward.
Candidate milestone unlocks (test, refine, add):
After 4 weeks of the loop: “Here’s the day of the week you actually execute the most” (from task completion timestamps).
After first quarter complete: “Your real conversion rate vs. industry average” (using their actuals against the benchmark library). As the data flywheel matures: “vs. similar businesses in your range.”
After two completed initiatives: “Your initiative pattern” — which channels you gravitate to, which underperform for you, what your operating playbook is.
After 6 months: “Your business’s growth shape” — visualization of how revenue is actually building, where the gaps are, what’s working.
After 12 months: “Your year in numbers” — a Spotify-Wrapped-style annual summary. The moment they renew and share.
Caution: reward leading indicators of business success (actuals entered, tasks completed against plan), not vanity metrics (initiatives created). Reward the wrong behavior and you get bloated plans full of junk initiatives.
15.7 The Monday-morning hook
Every operator wakes up Monday wondering “where are we?” If the product is the answer to that question, it is their operating system. If they have to remember to log in to check, it isn’t. So the accountability layer must PUSH to them: Monday-morning email or SMS — “here’s where you stand, here’s what’s due, here’s your top priority this week.” The product doesn’t wait to be opened; it shows up.
This is the delivery mechanism for the weekly cadence (Section 1.2). The accountability layer’s Level 2 (automated check-ins, Section 8.2) is exactly this push. Frame it as “where are we” not “log in to check” — deliver the answer, link to deeper drill-down. Most planning tools churn because they’re periodic; this product is weekly because the business is.
Three pieces that compound: the activation metric gets them to commit. The Monday-morning hook builds the habit. Milestone insights add delight on top. Together they answer the honest question about whether this product can retain.
16. Data, Privacy & Network Effects
This is the most defensible thing in the entire product. Published benchmarks are available to anyone; benchmarks derived from real outcomes across your own customer base are available to no one else and improve every month. A competitor can copy features — they cannot copy the data. And it compounds: more customers → more outcome data → more accurate benchmarks → better plans → more customers. A true network effect. Design toward it deliberately.
16.1 Two pipelines, two governance models
Customer-created initiatives and customer outcome data are different things with different rules. Keep them separate.
Pipeline
What flows
Governance
Initiatives
Customers create custom initiatives. The best become candidates for the shared library.
HUMAN-GATED. Nothing is ever auto-added. You review, validate, and deliberately promote. The library stays curated — your judgment is the quality bar.
Benchmark data
Real outcomes from initiatives customers run (show rates, conversions, etc.).
CONTINUOUS, anonymized, aggregated, opt-out. Feeds the benchmark models so rates get more accurate over time. Never exposes one customer’s specifics to another.

16.2 The collection mechanism already exists
No separate data-collection system is needed. The actuals/accountability layer (Section 8.2) is the collection mechanism. When a user enters “my webinar got a 30% show rate” for their own tracking, that same data point — anonymized and aggregated — feeds the benchmark models. One feature, two purposes: it helps the individual see if they’re on track, and it makes the whole product’s benchmarks smarter. The flywheel runs on data users already enter for their own benefit.
16.3 Data governance
Anonymized and aggregated only — benchmark data is distributions across many businesses, never one business’s numbers shown to another.
Opt-out with transparency — default-on contribution for anonymized benchmark data (this is what makes the flywheel work), but with clear disclosure at signup and a genuine, easy toggle. Note the tradeoff: opt-out yields far more data than opt-in but demands real transparency and clean anonymization to preserve trust.
Make participation a benefit, not just tolerated — e.g. contributors get access to live network benchmark insights. Turn data contribution into an exchange, not extraction.
Never sell or expose raw data. Be conservative and over-transparent — the reputational cost of mishandling data vastly outweighs the marginal benefit of squeezing out more of it. Get this right early; trust is hard to recover.
16.4 Integration partnerships and the flywheel
Platform integrations (Section 17) make the data flywheel much more powerful but they also raise the stakes on governance. When a customer connects their CRM, the product is now reading actual customer data — names, emails, deal sizes, conversion paths. That is PII-adjacent and contractually sensitive. Bake the guardrails in up front, do not retrofit them:
Read-only by default. No write access until and unless the customer explicitly enables it for a specific use case. Even then, scoped narrowly.
Aggregate-first reading. The product needs counts, conversion rates, pipeline values — not individual contact records. Pull what is needed at the aggregate level; do not vacuum the full CRM into our database.
Integration is separate from benchmark contribution. Connecting a CRM lets the product work on the customer’s own data. Contributing anonymized aggregates to the benchmark flywheel is a separate, opt-in decision. Customers should be able to use the integration without joining the flywheel, or join the flywheel without integration. Never bundle the consents.
Clean deletion paths. Disconnecting an integration deletes the pulled data within a defined window (e.g., 30 days). No silent retention.
No re-use beyond the explicit benefit. Integration data serves the customer’s plan and (with separate consent) the benchmark flywheel. It is not sold, not shared with partners, not used to train models that benefit other customers, and not retained beyond what the integration requires.
16.5 The three levels of customer-created initiatives
Build toward Level 3, where nothing is auto-added but the data flywheel runs underneath.
Level 1 — custom one-off initiatives, private to the user (a basic “add your own” escape hatch; useful even late-v1 because users hit the library’s edges fast).
Level 2 — full authoring: users build their own benchmarks, templates, and timing for power-user playbooks.
Level 3 — the best customer initiatives flow back as candidates for the shared library (human-gated), while anonymized outcome data continuously improves benchmarks for everyone. This is the network effect.
Architectural note for v1: because initiative types are already “data, not code” (Section 6.4), supporting this later mostly requires one schema decision now — an initiative type can be user-owned (private) or system-owned (shared). Bake that flag in so none of this is a retrofit.
16.6 Where the moat sits — and where it doesn’t
Stay honest about which assets actually defend the company and which do not. This matters because the next 24 months will include heavy competitive activity, particularly from AI-native startups, and over-investing in the wrong moat is a fast way to lose.
Where the moat does NOT sit: the AI itself. AI-generated plans from a structured intake will commoditize fast. By 2027 every major LLM platform and dozens of vertical SaaS companies will offer planning agents. If the company’s defense were “we generate plans with AI,” anyone with API access could replicate it in a weekend. Build the AI well — it is the entry point, the magic-moment generator, the activation surface — but do not over-invest in being “the best AI.” The AI is a feature, not the company.
Where the moat DOES sit: four assets that compound and cannot be cloned from a prompt.
The data flywheel (Sections 18.1, 18.2). Anonymized customer outcomes feeding back into benchmarks that get more accurate every quarter. A competitor entering in 2028 cannot reproduce our 2026–2027 outcome data. Each quarter we are accumulating, the moat thickens. This is the most important and most fragile asset — fragile because it requires customers to actually enter actuals (Section 15.5 activation metric). If they don’t, the flywheel does not spin and the moat does not form.
The community network. AI can generate plans; it cannot generate the trust that comes from a real operator network. The Operators Mastermind, the Founders Circle, the newsletter, the annual industry report — these compound social capital that competitors cannot fast-follow. Even a well-funded entrant would need years to build an equivalent peer network. This is moat-via-relationship, not moat-via-feature.
Platform integrations (Section 17). Once GoHighLevel and the other CRMs / funnel tools are connected, switching cost is real — the customer’s actual operational data lives in our system, and the weekly cadence runs on those flowing inputs. Competitors entering in 2028 will face the prospect of asking customers to disconnect and reconnect somewhere else. Most won’t make that switch.
The certified-operator network and Playbook Library (Section 17 roadmap). Once SAM Operators exist in the market as a credentialed designation, and the Playbook Library is the maintained reference standard for the methodology, the brand position is structural. Analogous to how EOS Implementers became the moat for EOS — the methodology and the people who deliver it are inseparable from the company.
The data-driven upsell pattern (Section 14.3). Every quarter of operation produces sharper signal about which customers are ready for what offer — targeted coaching, productized consulting, advisory engagements, segment-specific cohorts. This is a structural advantage in lead conversion that no software-only competitor (who lacks the signal) and no consulting-only competitor (who lacks the scale) can replicate. The combination of software at scale plus targeted high-touch services keyed to data is structurally harder to compete with than either alone.
Strategic implication: every quarter, ask the question — “what would a well-funded AI startup do to attack us, and what moat prevents it?” If the answer is “our product is better” or “our AI is smarter,” that is not a moat — it’s a temporary lead that will be erased. The answer must point to data, community, integrations, the certified network, or the data-driven upsell pattern. Build toward that answer relentlessly. The first 24 months are the most vulnerable window: the moats are forming but not yet thick. Move with urgency in that window.
17. Post-v1 Roadmap
Actuals tracking & variance analysis (enter monthly actuals; compare to Better scenario; visual over/under indicators).
Expand the initiative library (Tier 2, then Tier 3) — content tasks, not engineering.
Own vs. Ops dimension surfaced in the UI.
Progressive deep-dive diagnostic for serious users / Mastery reviews.
AI-personalized project tasks (Option C).
Certified reviewer program to scale Mastery reviews beyond you.
Multi-user collaboration, advanced dashboards, exports.
Mature in-product onboarding so 1:1 launch-phase calls can fully taper (see Section 15).
Automated check-ins (accountability Level 2) — the notification engine that pulls users back.
Agent check-ins (accountability Level 3), “Ask Pete,” and AI onboarding — one shared agent capability, trained on the human conversations run early.
Full affiliate/partner portal, multi-tier payouts, and a certified-partner directory (itself a revenue line).
Ascension / back-end offers — done-with-you implementation, certification, advisory, events.
Add-on services, AI-recommended from the plan’s difficulty profile (coaching, DWY/DFY, product creation, tech help) — decide marketplace vs. in-house delivery deliberately (Section 14.3).
Customer-created initiatives — Levels 1–3 (Section 16.5): private custom initiatives → full authoring → human-gated promotion to the shared library.
The benchmark data flywheel (Section 16) — anonymized, opt-out outcome data continuously improving the models. The core long-term moat; build the opt-out controls and anonymization pipeline before any data flows.
“Find hidden revenue” — analyze a business’s plan, products, and actuals to surface revenue it already has access to but isn’t capturing (un-pitched existing customers, a product-ladder gap, an unmailed list, a missing upsell, an unasked referral). Pure leverage — money from what already exists, not new effort. A visceral value demonstration (“we found you $80K you weren’t capturing”) and a potential sales wedge, not just a feature.
Platform integrations — CRM, email, funnel (2027). The weekly cadence runs on weekly inputs; the weekly inputs already live in the customer’s CRM, email platform, and funnel builder. Connecting directly eliminates manual entry (the activation killer) AND upgrades the data quality flowing into the flywheel. Sequenced:
Q2 2027 — GoHighLevel (first). Dominant platform among the operator audience and Pete’s network. Read-only at launch: contacts, opportunity stages, pipeline values, campaign performance, funnel conversions, mapped to SAM Plan AI initiative outcomes. Single highest-ROI integration we’ll build — eliminates manual-entry burden for ~30–40% of beachhead customers in one move. Approach GHL for a formal partnership BEFORE building (co-marketing, marketplace listing, possible revenue share). Warm-intro path: a team member has prior interaction history with one of the GHL founders — not a close personal relationship, but enough to bypass the cold-inbound form and request a real conversation. Approach in late 2026 / early 2027 once there is a product to show and traction to reference, not before. The relationship is a known-name asset, not a close one; treat it as a warm professional reintroduction, not a casual ask.
H2 2027 — ClickFunnels, Kajabi, ActiveCampaign. The next-densest platforms in the info-marketing segment. Architecture proven with GoHighLevel makes each subsequent integration faster.
2028 — HubSpot, Keap (Infusionsoft). HubSpot is larger but more enterprise-shaped (customers have their own integration teams). Keap is legacy installed base. Both are valuable; neither is urgent.
Discipline note: each integration is a permanent engineering commitment (APIs break, rate limits shift, support burden compounds). Five mediocre integrations is worse than one excellent one. The certified-operator network helps absorb first-line support over time.
Financial integration — QuickBooks and Xero (capstone, 2028). Real actuals flow automatically from the user’s books, eliminating the weakest point in the manual-entry model. Plan vs. actual updates by itself; the accountability layer runs on real data with zero user friction; the benchmark flywheel runs on accounting-grade outcomes instead of self-reported numbers. This is the move that completes the revenue operating system framing — the product becomes the lens the business sees its numbers through, not a tool sitting next to its books. Marketing/sales integration (CRM) comes first because that’s where the weekly cadence runs; financial integration follows because monthly cadence is less urgent and the security/liability stakes are higher.
Context-triggered optimization libraries — prescriptive AND diagnostic. When the user sets a target (“want the best show-up rate? here’s how to maximize it”); when they enter actuals (“you got 22% — here’s what likely caused it and what to fix next time”). Anchored to their specific numbers and business type, not generic. Requires capturing diagnostic dimensions per initiative in the schema, not just conversion math — worth knowing now.
The Playbook Library / Model Growth Program — the durable IP. A maintained, indexed, updated repository of best-in-class plays. The Deloitte “model audit program” analogy: well-documented frameworks that produce a competent result even when followed by a beginner. The natural home for the certified-partner program and a future credentialing path (“SAM Plan certified”). Maintenance and curation are an ongoing job; that job is the founder’s long-term seat (see Section 18). Structured as four tiers:
Initiative-level playbooks. One per Tier 1 initiative type (webinar, email campaign, challenge, paid ads, VSL/sales page, sales calls, content/organic, referral). The methodology for running that initiative well — what works, what doesn’t, the tweaks (e.g., webinar show-rate optimizations), the benchmarks to hit. v1 ships with minimum viable versions; the deep versions are the IP that justifies the higher tier (Section 14.3).
Campaign playbooks (multi-initiative, goal-oriented). The constellation of sub-initiatives that together make a campaign succeed. Includes: webinar fill map (strategies to drive registration), live event ticket map (already proven methodology), book launch playbook (the Pete+Rachel system that produced Eric Worre 40K+ books vs. comparable launches at half that), course/cohort launch, and others as they emerge. These overlap and plug into each other — e.g., a webinar is itself a tactic inside the event-fill playbook.
Foundational playbooks. Prerequisites that feed every initiative: creating a powerful offer (Pete’s signature expertise), bundle / stack architecture, developing your signature talk (Pete and Pat’s methodology), audience mapping, designing your product suite (the offer ladder). These are the playbooks that surface in the Foundation intake route (Section 3.4) and the inputs that every campaign and initiative draws from.
Segment playbooks (2028+). Industry / role / stage-of-business variants. Info marketing, coaching, agencies, e-commerce, network marketing; solo operator vs. team-led; early-stage vs. scaling vs. $1M+ vs. $10M+. Same methodology, adapted with the patterns that win in each context. Emerges from accumulated data and curation, not designed up front.
Architectural note: this is a structured library, not a flat repository. Playbooks reference each other (a webinar inside an event-fill campaign; a signature talk feeding a webinar; an offer feeding all of them). The data model needs to support these cross-references so users navigate naturally between connected playbooks.
Year-two: a podcast or public content layer drawing on customer stories and network data — the natural extension of the curator role once there’s material that makes it inevitable rather than additive. Do not start before launch.
Module roadmap (the Suite)
The full suite (Section 3) ships in deliberate, sequenced module releases over 2027–2028. Each module is a focused workstream with its own design, testing, and iteration window. Do not build in parallel.
Q1 2027 — Stage Database module. Ready to productize from existing static database + email templates. AI-connect for smart matching by topic / audience / goal, personalized outreach generation, strategic sequencing (start with smaller podcasts, build credibility, then flagship stages), and outcome tracking that feeds both the matching and the database itself. Standalone-viable; stronger inside the suite because stages are also an initiative type in the planning OS.
Q2 2027 — Signature Talk Builder. Productize Pete and Pat’s workshop methodology; eons of recorded coaching as training data. The strategically most important module because the Signature Talk is connective tissue across every initiative (Section 3.2): user develops their Talk once, AI adapts it into webinar scripts, ad copy, podcast pitches, sales-call frameworks, social content, email sequences. The Talk is captured as a first-class data object in v1 even though the full module ships here.
Q3 2027 — Perfect Product Suite Design. Productize the offer-ladder framework. Also activates the Foundation intake path (Section 5.3) for users who answer “I don’t know” to “who do you serve” or “what do you sell.” Helps users design what they sell before / while planning how to sell it. Anchors the 70% rule: most offer success is matching the right offer to the right audience.
H2 2027 — Ad Strategy &** Optimization.** The “grow with ads” module. Established frameworks, more development needed. Connects to the optimization libraries (prescriptive at target setting, diagnostic at outcome).
2028+ — Industry, role, and stage-of-business playbooks. Emerge later from accumulated data and curation: industry-specific playbooks (network marketing, coaching, agency, e-commerce, etc.), role-specific playbooks (solopreneur, agency owner, CMO / operator), stage-of-business playbooks (early-stage, scaling, $1M+, $10M+). Each becomes a packaging axis for the suite.
Operational discipline: quarterly competitive watch
Build a structured competitive scan into the company’s operating rhythm — once per quarter, owned by Rachel (or eventually a strategy hire), feeding a short internal report. Not paranoia; discipline. The threats that obsolete companies in this category will not come from the planning-tool incumbents (Asana, Monday, Notion). They will come from three specific directions, each of which warrants its own watch lens:
AI-native operator tools. Track YC batches, well-funded seed and Series A rounds, public Product Hunt launches, LinkedIn hiring signals for “AI marketing planner” / “AI revenue ops” / “AI for agencies” type roles. The companies that surprise us in 2027 will be the ones we did not see coming in 2026. Knowing what they are launching is the precondition for staying ahead of them.
EOS-adjacent and methodology-platform incumbents. EOS Worldwide has 30,000+ companies running their operating system; if they add a revenue-planning module or license one, that lands instantly into the installed base. Watch EOS Worldwide product announcements, Implementer-side tooling launches, and any partnership news between EOS and SaaS platforms. Defense: build relationships in the EOS ecosystem early, position as complement-not-competitor, possibly explore an explicit partnership (EOS Implementers as SAM Operators, methodology adjacency) before they decide to build their own version.
Platform incumbents building planning features. GoHighLevel, HubSpot, ClickFunnels, Kajabi could each decide to build revenue-planning features inside their own platforms. The integration partnership with GHL (Section 17) is partly about distribution but also about staying close to their roadmap — partnered companies sometimes get acquired, sometimes get ignored, sometimes get competed-with. Watch for the third outcome. Maintain optionality: partner with platforms now, but build the certification network and direct distribution so the company is not dependent on any single platform’s goodwill.
Output of the quarterly scan: a one-page internal memo with what changed, what it means for us, and what (if anything) we adjust. The point is not to react to every competitor; the point is to never be surprised by one. The strategic moves that protect the moat (Section 16.6) get prioritized faster when the threat to them is visible.
18. Principles to Hold While Building
Product obsession at the same level as sales obsession. The pattern that compromised prior efforts: world-class sales and marketing propping up under-built products. This venture corrects the pattern structurally. Rachel has full authority on product (intake, AI logic, data model, UX, the activation experience, the playbook library); Pete has full authority on sales and marketing (positioning, audience, partner outreach, public face). Each consults the other on their domain but defers on decisions inside it. The product is the best sales asset; sales is what gets the product in front of the people it serves. Both must be obsessed over, in parallel, by the partner whose seat it is. Product obsession is a culture, not a task list — Rachel sets impossible standards and trusts the team to meet them; she does not become the bottleneck on every UX decision.
This is a revenue operating system, not a planning tool. The weekly cadence is the heartbeat; every feature is a component of one weekly operating rhythm. But customers grow into the OS one proven layer at a time — v1 is the seed (plan + first weekly loop), not the whole system.
Build the core loop first. Intake → initiatives → projections → project plans. Everything else is enhancement.
A plan is not an outcome. The product’s job is execution and accountability, not generation. Design for all three levels; build the minimum viable version of each in v1.
Grand slam in architecture and vision; disciplined in the v1 build. Design for outcomes, partners, and economics from day one — build the minimum version now, not the maximal one.
Price to the outcome, not the tool. Accountability level can be the pricing tier.
Depth-per-initiative over breadth. A small library done fully beats a large library done hollow.
Initiative types are data, not code. Your expertise should not be bottlenecked behind engineering.
The 7 questions are the floor, not the ceiling. Progressive depth serves both casual and serious users.
Benchmarks and task sizing must be honest. First-party numbers are the moat; invented numbers destroy trust.
Model the unit economics before you build. Watch the labor-backed Mastery margin.
Leverage the roster. Partner distribution is designed in, not bolted on.
Do the high-touch version first to learn it, systematize it second, automate it with AI third. (Onboarding, reviews, check-ins, support all follow this arc.)
Meet users where they are. Quickstart for instant value, depth for those who want it, help (add-ons) for what’s hard. Difficulty ratings drive all three.
The benchmark data flywheel is the real moat. Initiatives are human-gated into the library; anonymized outcome data flows continuously to improve the models. Design for it, govern it transparently, and protect the trust it depends on.
The activation metric is hypothesized as ‘entered first actuals.’ Instrument it from day one, drive onboarding toward it, and validate or replace with real data within 90 days. Stickiness = activation + Monday-morning push + milestone self-discovery (Section 15.5–16.7).
The founder’s long-term seat is curator, not operator. Content engine, playbook maintenance, and benchmark curation collapse into one role: watching what works across the network, synthesizing patterns, updating the system. Protect that seat deliberately. Hire away the operator/CMO function over time; the curator role is the irreplaceable one and it gets richer the longer the company runs.
Don’t build subscriptions or extra features until the loop works and 3+ people say they’d pay.
Gut-check with your own businesses. If the generated plan is one you’d endorse, the intake is right.
19. How We’ll Work Together
This section is for us — not the rest of the spec. Twelve years of working together means we don’t have to spell out everything, but a few things are worth being explicit about because this build is structured differently than what we’ve done before.
19.1 The product comes first this time
The pattern we’ve all lived through across multiple ventures: sales and marketing get the focus and the product gets the leftovers. This build is structurally different. The product is the bar; sales and marketing serve it, not the other way around. Practically: when a tradeoff comes up between “ship faster to meet a marketing date” and “ship right to meet the product bar,” we choose the product bar. This is a one-line cultural shift that changes a lot of small decisions over an 18-month build. Worth naming so it’s shared from day one.
19.2 Decision authority
Rachel has product authority and is the final decision-maker on what gets built, in what order, and to what standard. Pete is the strategic partner and brand/audience leverage; he is not a product reviewer and does not get pulled into build decisions. The team builds against this spec and against Rachel’s direction; if there’s ambiguity, ask Rachel directly. Speed matters more than committee. We are not building this by consensus.
Tactical decisions inside the engineering domain (framework choices, database design, third-party tools, hosting, performance optimizations) belong to the team. We’re hiring you for judgment, not just execution. If you think the spec is wrong on something, say so — that’s exactly the conversation we want. The spec is the starting point, not the final word.
19.3 Cadence and communication
Weekly working sessions during the build (June–September 2026). Standing time, recurring, on the calendar. Agenda flexes but the rhythm doesn’t. The team eats its own dog food — we run this build on a weekly cadence because that’s the cadence the product itself enforces. Daily async communication for blockers (Slack or equivalent). End-of-week status: what shipped, what’s in flight, what’s blocked. Nothing fancy; just enough that everyone is on the same page going into the weekly session.
19.4 What we’ll provide you
Real benchmark data. First-party numbers from across our companies for every Tier 1 initiative. Documented and ready to seed the database before launch. This is not a “we’ll figure it out later” situation; the benchmark data is the moat (Section 16.6).
Initiative templates and playbook content. Written, structured, ready to load. Rachel owns producing these against the schema you implement.
AI prompt design and iteration. The Anthropic API calls for the initiative generator, the structured JSON output schema, and the prompt engineering for tone and content. Rachel will own these prompts; the team owns the infrastructure that runs them.
Visual and brand direction. Brand identity, copy, sales pages, marketing assets — not your problem. We’ll either bring in a designer or use the tools we already use. The team focuses on functional UX and clean code.
Customer research and feedback. Once we’re past v1, real customer signal flows back to the team weekly. You’re not building in a vacuum after September; we want your judgment on what to fix, what to ignore, and what the data is telling us.
19.5 What we need from you
Honesty about what’s realistic. The September 2026 date is real and the v1 scope is tight, but we want a real read on what fits and what doesn’t. If something in the spec is going to take three weeks longer than we’re planning, we want to know in week one, not week six. Cut scope, don’t cut quality; flag early, not late.
Architectural judgment, not just feature coding. This product needs to support integrations, AI execution agents, a white-label platform tier, and segment-specific playbooks by 2028. The v1 ships small but the foundation has to support all of that. Push back on decisions that make sense for v1 but would be a retrofit nightmare later. We’d rather spend an extra day on schema design than spend a quarter unwinding it in 2027.
Discipline on data governance from day one. The benchmark flywheel only works if customers trust how their data is handled. Read-only integrations, separate consent for benchmark contribution vs. integration, clean deletion paths, no quiet data retention. These are not v2 considerations — they are v1 architectural decisions. Section 16.4 covers the specifics.
Building this like it’s the durable thing. This is not a campaign or a launch project. The intent is a 10-year company. Code quality, test coverage, documentation, deployment hygiene — treat this like it’s going to be maintained by someone who isn’t you in three years (because at some point that’s true). The shortcuts that work for a 6-month campaign are not the right calls for a 10-year platform.
19.6 Compensation and engagement model
Engagement terms (rates, scope, hours, equity participation if any) are handled in the contract separately. This spec is the technical and operational frame; compensation lives in the engagement agreement. Open to discussing equity for key team members, particularly for anyone who stays through v1 and into the post-launch build — not because anyone has to take equity, but because the option should exist for people who want to participate in the upside.
19.7 The bigger picture
A note about why this one is different. We’ve built a lot of things together over twelve years — agencies, courses, events, campaigns, the whole stack. Most of it has been service-driven or event-driven, episodic by nature. This is different. SAM Plan AI is a software product that, if it works, becomes the operating system thousands of businesses run on for a decade. The category position is real. The architectural decisions you make in the next four months either enable or constrain what becomes possible in 2028, 2030, and beyond.
Read the strategic spec if you want the full vision. The short version: this is the platform play, not a project. Build accordingly.
Thank you for being part of this. Let’s build something worth maintaining.
Page
