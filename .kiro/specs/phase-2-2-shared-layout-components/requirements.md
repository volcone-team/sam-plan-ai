# Phase 2.2 — Shared Layout Components: Requirements

## Overview

Create reusable layout components that provide consistent page structure across the entire SAM Flow AI application. These are pure layout primitives — no business logic, no data fetching, no navigation. They consume the design tokens established in Phase 2.1.

## Scope

### In Scope
- AppContainer
- ContentContainer
- PageContainer
- SectionContainer
- PageHeader
- SectionHeader

### Out of Scope
- Business pages or routes
- Sidebar, navigation, breadcrumbs
- Data fetching or service consumption
- Authentication or user context
- Application shell chrome

### Dependency
- Phase 2.1 (Design System Foundation) must be implemented first. These components consume design tokens from globals.css.

---

## Requirements

### REQ-1: AppContainer

**ID:** REQ-1  
**Priority:** P0  
**Description:** The outermost layout wrapper that constrains the full application content area.

**Acceptance Criteria:**
- [ ] Wraps the main application content area (excludes sidebar/nav — those are Phase 2.3+)
- [ ] Applies max-width constraint configurable via prop (default: full width)
- [ ] Centers content horizontally when max-width is applied
- [ ] Responsive padding: tighter on mobile, wider on desktop
- [ ] Accepts `className` prop for composition
- [ ] Accepts `children` as ReactNode
- [ ] Strict TypeScript: all props typed, no `any`
- [ ] Uses design tokens for spacing (no hardcoded values)

---

### REQ-2: ContentContainer

**ID:** REQ-2  
**Priority:** P0  
**Description:** A content-width wrapper for constraining readable content within a page.

**Acceptance Criteria:**
- [ ] Constrains content to a readable max-width (default: `--container-lg` / 1024px)
- [ ] Supports variant widths: `sm`, `md`, `lg`, `xl`, `full`
- [ ] Centers content horizontally
- [ ] Applies consistent horizontal padding
- [ ] Accepts `className` prop for composition
- [ ] Accepts `children` as ReactNode
- [ ] Accepts optional `as` prop for semantic HTML element (div, main, section, article)
- [ ] Strict TypeScript with discriminated props

---

### REQ-3: PageContainer

**ID:** REQ-3  
**Priority:** P0  
**Description:** The primary wrapper for a page's content area, providing consistent vertical spacing and structure.

**Acceptance Criteria:**
- [ ] Applies consistent vertical padding (top and bottom)
- [ ] Applies consistent horizontal padding for mobile edge spacing
- [ ] Supports optional max-width constraint
- [ ] Provides vertical gap between direct children (configurable: `sm`, `md`, `lg`)
- [ ] Accepts `className` prop for composition
- [ ] Accepts `children` as ReactNode
- [ ] Renders as `<main>` by default (for accessibility)
- [ ] Strict TypeScript

---

### REQ-4: SectionContainer

**ID:** REQ-4  
**Priority:** P0  
**Description:** A grouping container for logical sections within a page.

**Acceptance Criteria:**
- [ ] Provides consistent vertical spacing between sections
- [ ] Supports optional border-bottom separator between siblings
- [ ] Supports optional background color variant (default, muted, elevated)
- [ ] Supports optional padding variant (none, sm, md, lg)
- [ ] Accepts `className` prop for composition
- [ ] Accepts `children` as ReactNode
- [ ] Renders as `<section>` by default (for accessibility)
- [ ] Accepts optional `aria-labelledby` for screen readers
- [ ] Strict TypeScript

---

### REQ-5: PageHeader

**ID:** REQ-5  
**Priority:** P0  
**Description:** A standardized page-level header with title, optional description, and optional action area.

**Acceptance Criteria:**
- [ ] Displays page title using heading typography (h1)
- [ ] Supports optional description/subtitle below the title
- [ ] Supports optional right-aligned action area (for buttons, etc.)
- [ ] Responsive: actions stack below title on mobile, align right on desktop
- [ ] Supports optional breadcrumb slot (renders above title)
- [ ] Consistent bottom spacing/border to separate from page content
- [ ] Accepts `className` prop for composition
- [ ] Title and description accept `string` or `ReactNode`
- [ ] Action area accepts `ReactNode`
- [ ] Strict TypeScript: all props typed
- [ ] No business logic — purely presentational

---

### REQ-6: SectionHeader

**ID:** REQ-6  
**Priority:** P0  
**Description:** A standardized section-level header with title, optional description, and optional action area.

**Acceptance Criteria:**
- [ ] Displays section title using heading typography (h2 by default)
- [ ] Supports configurable heading level (h2, h3, h4) via `as` prop
- [ ] Supports optional description below the title
- [ ] Supports optional right-aligned action area
- [ ] Responsive: actions stack below title on mobile, align right on desktop
- [ ] Smaller scale than PageHeader (section-level hierarchy)
- [ ] Consistent bottom spacing
- [ ] Accepts `className` prop for composition
- [ ] Title and description accept `string` or `ReactNode`
- [ ] Action area accepts `ReactNode`
- [ ] Strict TypeScript
- [ ] No business logic — purely presentational

---

## Cross-Cutting Requirements

### REQ-7: Responsiveness

**ID:** REQ-7  
**Priority:** P0  
**Description:** All components must be fully responsive using mobile-first design.

**Acceptance Criteria:**
- [ ] Base styles target mobile (320px+)
- [ ] Breakpoint adjustments at sm (640px), md (768px), lg (1024px)
- [ ] No horizontal overflow at any viewport
- [ ] Touch-friendly spacing on mobile
- [ ] Components work correctly when nested

---

### REQ-8: TypeScript Strictness

**ID:** REQ-8  
**Priority:** P0  
**Description:** All components must be fully typed with strict TypeScript.

**Acceptance Criteria:**
- [ ] All props interfaces exported
- [ ] No `any` types
- [ ] Props use proper React types (ReactNode, HTMLAttributes, etc.)
- [ ] Components extend native HTML element props where appropriate
- [ ] All optional props explicitly marked
- [ ] Components use `React.forwardRef` where appropriate for ref forwarding

---

### REQ-9: Composition & Extensibility

**ID:** REQ-9  
**Priority:** P0  
**Description:** Components must be composable and extensible without modification.

**Acceptance Criteria:**
- [ ] All components accept `className` for Tailwind composition
- [ ] Classes merged using `cn()` utility (clsx + tailwind-merge)
- [ ] Components are unstyled enough to be extended, styled enough to be useful standalone
- [ ] No internal state — all components are purely presentational
- [ ] No side effects
- [ ] No data fetching

---

## Technical Constraints

| Constraint | Value |
|---|---|
| Framework | Next.js 16 (App Router) |
| React | 19.x |
| TypeScript | Strict mode |
| Styling | Tailwind CSS v4 + design tokens |
| Class Utility | cn() from lib/utils.ts |
| Component Type | Server Components by default (no "use client") |
| Props Pattern | Interface-first, exported |

## File Organization

```
src/
  components/
    layout/
      app-container.tsx
      content-container.tsx
      page-container.tsx
      section-container.tsx
      page-header.tsx
      section-header.tsx
      index.ts              ← barrel export
```

## Naming Conventions

- Files: kebab-case (`page-container.tsx`)
- Components: PascalCase (`PageContainer`)
- Props interfaces: `{ComponentName}Props`
- Exports: named exports (no default exports)

---

## Exit Criteria

- [ ] All 6 components created and exported
- [ ] All components consume design tokens (no hardcoded values)
- [ ] All components fully typed (strict TypeScript, no `any`)
- [ ] All components responsive (mobile-first)
- [ ] No business logic in any component
- [ ] Components are Server Components (no "use client" directive)
- [ ] Build passes (`next build`)
- [ ] TypeScript passes (strict mode)
