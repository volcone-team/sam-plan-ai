# Phase 2.3 — Desktop Sidebar: Requirements

## Overview

Build the primary application sidebar for SAM Flow AI. This is the main navigation element for the desktop experience. It provides route-based navigation with icons, active state highlighting, and a collapsible mode. No authentication, no permissions, no page content.

## Scope

### In Scope
- Desktop sidebar component
- Navigation items with icons and labels
- Active route highlighting
- Collapsible/expanded toggle
- SAM Flow AI logo/branding
- Responsive behaviour (hidden on mobile — mobile nav is a separate phase)

### Out of Scope
- Page content or business logic
- Authentication or user context
- Permission-based route filtering
- Mobile navigation (separate phase)
- Breadcrumbs
- Header bar
- User profile/avatar in sidebar

### Dependencies
- Phase 2.1 (Design System Foundation) — design tokens
- Phase 2.2 (Shared Layout Components) — layout containers

---

## Requirements

### REQ-1: Sidebar Structure

**ID:** REQ-1  
**Priority:** P0  
**Description:** A fixed vertical sidebar on the left side of the application that contains the logo, navigation items, and collapse toggle.

**Acceptance Criteria:**
- [ ] Fixed position on the left side of the viewport
- [ ] Full viewport height (100vh / 100dvh)
- [ ] Width: expanded (240px), collapsed (64px)
- [ ] Contains three sections: logo (top), navigation (middle, scrollable), footer actions (bottom)
- [ ] Background uses design token (sidebar background)
- [ ] Border-right separator
- [ ] Z-index layered above page content
- [ ] Smooth width transition on collapse/expand (uses motion tokens)

---

### REQ-2: Logo / Branding

**ID:** REQ-2  
**Priority:** P0  
**Description:** The SAM Flow AI brand mark displayed at the top of the sidebar.

**Acceptance Criteria:**
- [ ] Displayed at the top of the sidebar
- [ ] In expanded mode: shows full logo text "SAM Flow AI"
- [ ] In collapsed mode: shows abbreviated mark or icon only
- [ ] Links to dashboard (root route `/`)
- [ ] Uses design tokens for typography and color
- [ ] Consistent vertical alignment with navigation items below

---

### REQ-3: Navigation Items

**ID:** REQ-3  
**Priority:** P0  
**Description:** The primary navigation links rendered in the sidebar.

**Navigation Structure:**
| Label | Icon (Lucide) | Route |
|---|---|---|
| Dashboard | `LayoutDashboard` | `/dashboard` |
| Planner | `Calendar` | `/planner` |
| Initiatives | `Rocket` | `/initiatives` |
| Reports | `BarChart3` | `/reports` |
| Settings | `Settings` | `/settings` |
| Help | `HelpCircle` | `/help` |

**Acceptance Criteria:**
- [ ] Each item displays an icon and label text
- [ ] In collapsed mode: only icon visible, label hidden
- [ ] In collapsed mode: tooltip shows label on hover
- [ ] Items rendered as Next.js `<Link>` components for client-side navigation
- [ ] Consistent spacing between items (uses spacing tokens)
- [ ] Icons sourced from Lucide React
- [ ] Icon size: 20px (default icon token)
- [ ] Items are keyboard navigable (tab order)
- [ ] Items have accessible names (aria-label when collapsed)

---

### REQ-4: Active Route Highlighting

**ID:** REQ-4  
**Priority:** P0  
**Description:** The currently active navigation item is visually distinguished from others.

**Acceptance Criteria:**
- [ ] Active item uses distinct background color (primary/muted)
- [ ] Active item text and icon use primary/accent color
- [ ] Active state determined by current pathname (using `usePathname()`)
- [ ] Supports nested routes: `/initiatives/123` highlights "Initiatives"
- [ ] Non-active items show hover state on mouse enter
- [ ] Hover state is distinct from active state
- [ ] Transition between states uses motion tokens

---

### REQ-5: Collapsible Sidebar

**ID:** REQ-5  
**Priority:** P0  
**Description:** The sidebar can toggle between expanded and collapsed states.

**Acceptance Criteria:**
- [ ] Toggle button visible at the bottom of the sidebar (or integrated into footer)
- [ ] Toggle icon: chevron-left when expanded, chevron-right when collapsed
- [ ] Collapse state persisted in localStorage
- [ ] Width animates smoothly between 240px and 64px
- [ ] Page content area adjusts to fill available space
- [ ] Collapsed state shows only icons (no text labels)
- [ ] Tooltip appears on nav items when collapsed (showing the label)
- [ ] Keyboard shortcut: `Cmd+B` / `Ctrl+B` to toggle (optional, P2)

---

### REQ-6: Responsive Behaviour

**ID:** REQ-6  
**Priority:** P0  
**Description:** The sidebar adapts to different viewport sizes.

**Acceptance Criteria:**
- [ ] Visible on desktop: `lg` breakpoint and above (1024px+)
- [ ] Hidden on mobile/tablet: below `lg` breakpoint
- [ ] When hidden, page content takes full width
- [ ] No horizontal scroll caused by sidebar at any viewport
- [ ] Smooth show/hide at breakpoint boundary (no layout jump)
- [ ] Mobile navigation handled by a separate component (not this phase)

---

### REQ-7: Accessibility

**ID:** REQ-7  
**Priority:** P0  
**Description:** The sidebar must be accessible to keyboard and screen reader users.

**Acceptance Criteria:**
- [ ] Sidebar uses `<nav>` element with `aria-label="Main navigation"`
- [ ] Navigation items in an `<ul>` / `<li>` structure
- [ ] All items keyboard focusable in logical tab order
- [ ] Focus ring visible on keyboard navigation (uses focus tokens)
- [ ] Active item conveyed to screen readers (`aria-current="page"`)
- [ ] Collapse toggle has accessible label ("Collapse sidebar" / "Expand sidebar")
- [ ] Tooltips accessible (associated via `aria-describedby` or tooltip role)
- [ ] Reduced motion: transitions respect `prefers-reduced-motion`

---

### REQ-8: TypeScript & Component Architecture

**ID:** REQ-8  
**Priority:** P0  
**Description:** The sidebar must be strictly typed and well-architected.

**Acceptance Criteria:**
- [ ] Navigation config is a typed array (route, label, icon) — not hardcoded JSX
- [ ] Props interface exported for each sub-component
- [ ] No `any` types
- [ ] Component is a Client Component (`"use client"`) since it uses hooks (usePathname, useState)
- [ ] State management via React useState (no external state library)
- [ ] No business logic — only navigation and presentation

---

## Technical Constraints

| Constraint | Value |
|---|---|
| Framework | Next.js 16 (App Router) |
| React | 19.x |
| TypeScript | Strict mode |
| Styling | Tailwind CSS v4 + design tokens |
| Icons | Lucide React |
| Routing | Next.js Link + usePathname |
| Component Type | Client Component ("use client") |
| State | React useState + localStorage |

## File Organization

```
src/
  components/
    sidebar/
      sidebar.tsx              ← Main sidebar component
      sidebar-nav-item.tsx     ← Individual nav item
      sidebar-logo.tsx         ← Logo/brand section
      sidebar-toggle.tsx       ← Collapse toggle button
      sidebar-config.ts        ← Navigation items configuration (typed array)
      index.ts                 ← Barrel export
```

## Naming Conventions

- Files: kebab-case
- Components: PascalCase
- Props: `{ComponentName}Props`
- Config: typed `const` with `as const` or explicit interface
- Exports: named exports (no default exports)

---

## Exit Criteria

- [ ] Sidebar renders with all 6 navigation items
- [ ] Active route highlighted based on current pathname
- [ ] Sidebar collapses and expands with smooth animation
- [ ] Collapse state persists across page refreshes
- [ ] Hidden on viewports below 1024px
- [ ] All items keyboard accessible
- [ ] Screen reader announces navigation structure correctly
- [ ] No business logic or authentication code
- [ ] Build passes (`next build`)
- [ ] TypeScript passes (strict mode)
