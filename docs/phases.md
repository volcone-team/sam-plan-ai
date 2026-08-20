# SAM Flow AI
# Production Build Phases (Frontend First)

## Philosophy

SAM Flow AI is a Revenue Operating System.

The objective of Phase 1 is to build a production-ready frontend using mock JSON and a service layer.

No Supabase.
No Stripe.
No Anthropic.
No authentication.

Every screen must consume data through services.

The UI must never import JSON directly.

Once the frontend is complete, JSON services will be replaced by Supabase without changing the UI.

---

# Phase 0 — Engineering Foundation

Goal

Create a production-ready Next.js foundation.

Deliverables

- Next.js App Router
- TypeScript (Strict)
- Tailwind CSS
- shadcn/ui
- ESLint
- Prettier
- Husky
- Theme Provider
- Folder Structure
- Environment Validation
- Providers
- Path Aliases
- Global Layout
- CI-ready scripts

Exit Criteria

✓ Project runs locally

✓ TypeScript passes

✓ ESLint passes

✓ Folder structure finalized

---

# Phase 1 — Domain & Mock Data

Goal

Design the complete application data model before building UI.

Deliverables

Entities

- Company
- User
- Product
- Annual Plan
- Planning Inputs
- Initiative Type
- Initiative
- Task
- Result
- Projection
- Benchmark
- Expense
- Report
- Subscription

Mock Data

/company.json

/products.json

/plans.json

/planning-inputs.json

/initiative-types.json

/initiatives.json

/tasks.json

/results.json

/projections.json

/benchmarks.json

/expenses.json

/reports.json

/questionnaire.json

Service Layer

company.service.ts

product.service.ts

plan.service.ts

initiative.service.ts

task.service.ts

result.service.ts

projection.service.ts

benchmark.service.ts

expense.service.ts

report.service.ts

questionnaire.service.ts

Exit Criteria

✓ Every entity has JSON

✓ Every entity has service

✓ No UI imports JSON directly

---

# Phase 2 — Application Shell

Goal

Build the shared application framework.

Deliverables

- Sidebar
- Header
- Breadcrumbs
- Mobile Navigation
- Theme Toggle
- Empty States
- Loading States
- Error States

Exit Criteria

✓ Navigation complete

✓ Responsive

---

# Phase 3 — Public Experience

Goal

Build the public website.

Deliverables

Landing Page

Generate My Plan

Sample Plan

Quickstart

Full Plan

Exit Criteria

✓ Public flow complete

---

# Phase 4 — Questionnaire

Goal

Collect business planning information.

Deliverables

Business Goals

Products

Audience

Marketing

Assets

Budget

Obstacles

Review Answers

Generate Plan

Loading Screen

Exit Criteria

✓ Questionnaire complete

---

# Phase 5 — Initiative Engine (CORE)

Goal

Build the heart of SAM Flow AI.

Everything in the application revolves around Initiatives.

Deliverables

## Initiative Library

- Initiative List
- Filters
- Search

## Initiative Detail

Overview

Revenue

Budget

ROI

Registrants

Show Rate

Offer Conversion

Timeline

## Why This Initiative

## Benchmark

## Revenue Scenarios

Good

Better

Best

## Project Plan

Task Timeline

Progress

Dependencies

## Task Management

Task List

Task Detail

Edit Task

Add Task

Delete Task

Status Updates

## Results

Results Log

Add Results

Historical Results

Expenses

Exit Criteria

✓ Complete Initiative lifecycle

---

# Phase 6 — Planning Views

Goal

Visualize initiatives across different planning horizons.

Deliverables

Year-at-a-Glance

Quarter

Month

Week

Day

Calendar

Timeline

Exit Criteria

✓ All planning views operational

---

# Phase 7 — Dashboard

Goal

Build the operating dashboard.

Deliverables

Revenue Summary

Budget Summary

Top Priorities

Upcoming Tasks

Active Initiatives

Recent Results

Passive Accountability

Exit Criteria

✓ Dashboard complete

---

# Phase 8 — Weekly Operating System

Goal

Build the weekly operating cadence.

Deliverables

Weekly Workflow

1. Enter Results

2. Compare Against Plan

3. Upcoming Tasks

4. Adjust Plan

5. Weekly Priorities

Exit Criteria

✓ Weekly operating loop complete

---

# Phase 9 — Reports

Goal

Business reporting.

Deliverables

Sales by Product

Sales by Period

Revenue

Expenses

ROI

Export CSV

Exit Criteria

✓ Reports complete

---

# Phase 10 — Help & Settings

Goal

Complete the application.

Deliverables

Company Settings

User Profile

Subscription

Benchmark Participation

SAM University

FAQ

Quick Start Guide

Exit Criteria

✓ Frontend Complete

---

# Phase 11 — Supabase Integration

Replace JSON.

Deliverables

Authentication

Database

Row Level Security

Persistence

Realtime

Exit Criteria

✓ No JSON dependency

---

# Phase 12 — Anthropic AI

Replace mock planning.

Deliverables

AI Intake Analysis

AI Initiative Selection

AI Revenue Projections

AI Recommendations

Regenerate Plan

Exit Criteria

✓ AI planning operational

---

# Phase 13 — Stripe

Deliverables

Checkout

Subscriptions

Customer Portal

Billing

Usage Limits

Exit Criteria

✓ Billing operational

---

# Phase 14 — Platform Integrations

Deliverables

GoHighLevel

Zoom

Wistia

ClickFunnels

Kajabi

QuickBooks

Exit Criteria

✓ External integrations complete

---

# Phase 15 — Admin Portal

Goal

Internal management application.

Deliverables

Dashboard

Companies

Users

Plans

Initiatives

Benchmarks

Prompt Library

Subscriptions

Analytics

Logs

Feature Flags

Exit Criteria

✓ Admin operational

---

# Final Build Dependency

Engineering Foundation

↓

Domain Model

↓

Mock Data

↓

Services

↓

Application Shell

↓

Public Experience

↓

Questionnaire

↓

Initiative Engine

↓

Planning Views

↓

Dashboard

↓

Weekly Operating System

↓

Reports

↓

Settings

↓

Supabase

↓

Anthropic

↓

Stripe

↓

Integrations

↓

Admin Portal