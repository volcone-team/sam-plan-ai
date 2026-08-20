# Phase 2.1 — Design System Foundation: Requirements

## Overview

SAM Flow AI is a production-grade Revenue Operating System for service businesses and coaches. This specification defines the global design foundation that every future screen, component, and feature will consume. This is an infrastructure layer — not a business feature, not UI pages, not navigation.

## Scope

### In Scope
- Design tokens (CSS custom properties)
- Color system with light and dark themes
- Typography scale
- Spacing scale
- Border radius scale
- Shadow and elevation system
- Container widths
- Responsive breakpoints
- Motion and animation standards
- Focus states and accessibility primitives
- Icon standards
- Chart color palette
- Status colors
- Semantic colors
- Form validation colors
- Theme switching mechanism

### Out of Scope
- Application pages
- Application shell (sidebar, header, breadcrumbs)
- Navigation components
- Business logic
- Data fetching
- Mock data consumption
- Any screen or route

---

## Requirements

### REQ-1: Design Token Architecture

**ID:** REQ-1  
**Priority:** P0  
**Description:** All visual properties must be expressed as CSS custom properties (design tokens) defined in a single source of truth. No component may use hardcoded color, spacing, or typography values.

**Acceptance Criteria:**
- [ ] All tokens defined as CSS custom properties on `:root`
- [ ] Dark theme tokens defined via `[data-theme="dark"]` or `.dark` selector
- [ ] Tokens follow a consistent naming convention: `--{category}-{property}-{variant}`
- [ ] Tailwind CSS v4 consumes tokens via `@theme inline` directive
- [ ] No hardcoded hex/rgb values in component styles

---

### REQ-2: Color System

**ID:** REQ-2  
**Priority:** P0  
**Description:** A comprehensive color system using HSL values that supports semantic naming, theming, and accessibility contrast requirements.

**Acceptance Criteria:**
- [ ] Primary brand color scale (50–950)
- [ ] Neutral/gray scale (50–950)
- [ ] Background colors (default, subtle, muted, elevated)
- [ ] Foreground colors (default, muted, subtle)
- [ ] Border colors (default, muted, strong)
- [ ] All color pairs meet WCAG AA contrast ratio (4.5:1 for text, 3:1 for UI elements)

---

### REQ-3: Semantic Colors

**ID:** REQ-3  
**Priority:** P0  
**Description:** Named semantic color tokens for application-level meaning that map to the base color system.

**Acceptance Criteria:**
- [ ] Status colors: success, warning, error, info (each with foreground, background, border variants)
- [ ] Form validation colors: valid, invalid, focus (foreground + background + border)
- [ ] Interactive colors: primary, secondary, destructive, ghost (foreground + background + border + hover)
- [ ] Chart palette: minimum 8 distinguishable colors that work in both themes
- [ ] Accent color for highlights and active states

---

### REQ-4: Light Theme

**ID:** REQ-4  
**Priority:** P0  
**Description:** A complete light theme as the default appearance.

**Acceptance Criteria:**
- [ ] Light backgrounds with dark foreground text
- [ ] All interactive elements clearly visible
- [ ] Sufficient contrast on all surfaces
- [ ] Cards and elevated surfaces distinguishable from page background
- [ ] Applied by default (no user action required)

---

### REQ-5: Dark Theme

**ID:** REQ-5  
**Priority:** P0  
**Description:** A complete dark theme as an alternative appearance.

**Acceptance Criteria:**
- [ ] Dark backgrounds with light foreground text
- [ ] Reduced brightness without losing readability
- [ ] Elevated surfaces lighter than base background (dark mode convention)
- [ ] All interactive elements clearly visible
- [ ] Togglable via theme switcher (next-themes)
- [ ] Respects system preference via `prefers-color-scheme`
- [ ] Persists user choice across sessions

---

### REQ-6: Typography Scale

**ID:** REQ-6  
**Priority:** P0  
**Description:** A responsive typography scale using fluid sizing or breakpoint-based scaling.

**Acceptance Criteria:**
- [ ] Font size tokens: xs, sm, base, lg, xl, 2xl, 3xl, 4xl, 5xl
- [ ] Line height tokens paired with each size
- [ ] Font weight tokens: normal (400), medium (500), semibold (600), bold (700)
- [ ] Letter spacing tokens for headings and body
- [ ] Responsive: sizes scale appropriately on mobile vs desktop
- [ ] Display/heading sizes distinct from body sizes

---

### REQ-7: Font Families

**ID:** REQ-7  
**Priority:** P0  
**Description:** Font family tokens for the application.

**Acceptance Criteria:**
- [ ] Sans-serif family for UI text (Geist Sans or Inter)
- [ ] Monospace family for code/data (Geist Mono or JetBrains Mono)
- [ ] Font families loaded via `next/font` for performance
- [ ] Fallback stacks defined for each family
- [ ] Tokens: `--font-sans`, `--font-mono`

---

### REQ-8: Spacing Scale

**ID:** REQ-8  
**Priority:** P0  
**Description:** A consistent spacing scale based on a 4px base unit.

**Acceptance Criteria:**
- [ ] Scale: 0, 0.5 (2px), 1 (4px), 1.5 (6px), 2 (8px), 3 (12px), 4 (16px), 5 (20px), 6 (24px), 8 (32px), 10 (40px), 12 (48px), 16 (64px), 20 (80px), 24 (96px)
- [ ] Used for padding, margin, gap
- [ ] Available as Tailwind utilities
- [ ] Consistent application: components use scale values, never arbitrary pixel values

---

### REQ-9: Border Radius Scale

**ID:** REQ-9  
**Priority:** P0  
**Description:** A border radius scale for consistent rounding across components.

**Acceptance Criteria:**
- [ ] Tokens: none (0), sm (2px), default/md (6px), lg (8px), xl (12px), 2xl (16px), full (9999px)
- [ ] A base `--radius` token that shadcn/ui components reference
- [ ] All components use token values, not hardcoded radii

---

### REQ-10: Shadow & Elevation Scale

**ID:** REQ-10  
**Priority:** P0  
**Description:** A shadow scale that provides visual depth hierarchy.

**Acceptance Criteria:**
- [ ] Elevation levels: none, sm, default, md, lg, xl, 2xl
- [ ] Shadows adapt to theme (darker in light mode, subtler in dark mode)
- [ ] Ring/outline shadows for focus states
- [ ] Inset shadow option for pressed/active states

---

### REQ-11: Container Widths

**ID:** REQ-11  
**Priority:** P1  
**Description:** Named container width tokens for page layouts.

**Acceptance Criteria:**
- [ ] Widths: sm (640px), md (768px), lg (1024px), xl (1280px), 2xl (1536px)
- [ ] A max-width for content areas (prose: 65ch)
- [ ] Full-width option for dashboard layouts

---

### REQ-12: Responsive Breakpoints

**ID:** REQ-12  
**Priority:** P0  
**Description:** Mobile-first responsive breakpoints.

**Acceptance Criteria:**
- [ ] Breakpoints: sm (640px), md (768px), lg (1024px), xl (1280px), 2xl (1536px)
- [ ] Mobile-first: base styles target mobile, breakpoints add desktop overrides
- [ ] Available as Tailwind responsive prefixes
- [ ] Consistent with Tailwind v4 defaults

---

### REQ-13: Motion & Animation Standards

**ID:** REQ-13  
**Priority:** P1  
**Description:** Standardized animation durations, easing curves, and motion tokens.

**Acceptance Criteria:**
- [ ] Duration tokens: fast (100ms), default (200ms), slow (300ms), slower (500ms)
- [ ] Easing tokens: default (ease-out), in (ease-in), in-out (ease-in-out), spring (cubic-bezier)
- [ ] Respects `prefers-reduced-motion`: animations disabled when user prefers reduced motion
- [ ] Transition tokens for common properties (opacity, transform, colors)

---

### REQ-14: Focus States & Accessibility

**ID:** REQ-14  
**Priority:** P0  
**Description:** Visible, consistent focus indicators that meet WCAG AA requirements.

**Acceptance Criteria:**
- [ ] Focus ring: 2px offset, using primary or high-contrast color
- [ ] Focus-visible only (no focus ring on mouse click)
- [ ] Keyboard navigation clearly indicated
- [ ] Focus ring contrast meets 3:1 against adjacent colors
- [ ] Skip-to-content link styles defined
- [ ] Reduced motion support for focus transitions

---

### REQ-15: Icon Standards

**ID:** REQ-15  
**Priority:** P1  
**Description:** Standardized icon sizing and usage rules.

**Acceptance Criteria:**
- [ ] Icon sizes: xs (12px), sm (16px), default (20px), lg (24px), xl (32px)
- [ ] Icons use `currentColor` for fill/stroke
- [ ] Icon library: Lucide React (already installed)
- [ ] Stroke width standardized (1.5px or 2px)
- [ ] Accessible: decorative icons use `aria-hidden`, meaningful icons use `aria-label`

---

### REQ-16: Chart Color Palette

**ID:** REQ-16  
**Priority:** P1  
**Description:** A dedicated palette for data visualizations that is distinguishable and accessible.

**Acceptance Criteria:**
- [ ] Minimum 8 distinct, ordered colors
- [ ] Colors distinguishable for colorblind users (avoid red/green adjacency)
- [ ] Works on both light and dark backgrounds
- [ ] Tokens: `--chart-1` through `--chart-8` (minimum)
- [ ] Consistent hue spacing for categorical data

---

### REQ-17: Theme Architecture

**ID:** REQ-17  
**Priority:** P0  
**Description:** Theme switching infrastructure using next-themes.

**Acceptance Criteria:**
- [ ] `next-themes` ThemeProvider wraps the application
- [ ] Supports: light, dark, system
- [ ] Theme persists in localStorage
- [ ] No flash of wrong theme on page load (SSR-safe)
- [ ] `suppressHydrationWarning` on `<html>` element
- [ ] Theme class applied to `<html>` element

---

## Technical Constraints

| Constraint | Value |
|---|---|
| CSS Framework | Tailwind CSS v4 |
| Component Library | shadcn/ui |
| Theme Provider | next-themes |
| Variable Format | CSS custom properties (HSL values) |
| Responsive Strategy | Mobile-first |
| Accessibility Standard | WCAG 2.1 AA |
| TypeScript | Strict mode |
| Next.js | 16.x (App Router) |
| React | 19.x |

## Naming Conventions

All tokens must follow this pattern:
- Colors: `--{semantic}-{variant}` (e.g., `--primary`, `--primary-foreground`)
- Spacing: uses Tailwind's numeric scale
- Typography: `--font-{family}`, `--text-{size}`
- Radius: `--radius` as base, computed variants
- Shadows: `--shadow-{level}`
- Animation: `--duration-{speed}`, `--ease-{type}`

## File Organization

```
src/
  app/
    globals.css          ← Design tokens + theme definitions
    layout.tsx           ← ThemeProvider, font loading
  components/
    ui/                  ← shadcn/ui components (consume tokens)
  lib/
    utils.ts             ← cn() utility (clsx + tailwind-merge)
```

## Dependencies Required

| Package | Purpose |
|---|---|
| next-themes | Theme switching (light/dark/system) |
| tailwind-merge | Merge Tailwind classes without conflicts |
| class-variance-authority | Component variant management |
| shadcn/ui (CLI) | Component scaffolding that uses the token system |

---

## Exit Criteria

- [ ] All design tokens configured as CSS custom properties
- [ ] Light theme renders correctly
- [ ] Dark theme renders correctly
- [ ] Theme toggle switches between light/dark/system
- [ ] Typography is responsive across breakpoints
- [ ] No hardcoded visual values in any file
- [ ] Build passes (`next build`)
- [ ] TypeScript passes (strict mode)
- [ ] Tailwind utilities resolve all token values
