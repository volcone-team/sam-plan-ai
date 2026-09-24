import Image from "next/image";
import { cn } from "@/lib/utils";

interface BrandLogoProps {
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Brand logo that swaps between light and dark versions.
 *
 * Both images are rendered and toggled entirely in CSS — no useTheme(),
 * no client JS. next-themes sets the `.dark` class on <html> via a blocking
 * script before first paint, so the swap is correct immediately with no
 * SSR/hydration flash. This is why it stays a server component.
 *
 * Visibility is driven by the `.brand-logo-light` / `.brand-logo-dark`
 * classes defined in globals.css (see the "BRAND LOGO DARK-MODE SWAP" block).
 * The `.dark .brand-logo-*` rules have specificity 0,2,0, so they reliably
 * win regardless of stylesheet source order — and beat any single-class
 * display utility a caller passes via `className`. We deliberately avoid
 * competing Tailwind `block`/`dark:hidden` utilities on the same element,
 * because the project's `dark:` variant uses a zero-specificity
 * `:where(.dark, .dark *)` selector, which would tie with the base utility
 * and leave the winner up to unreliable source order.
 */
export function BrandLogo({ width = 120, height = 40, className }: BrandLogoProps) {
  return (
    <>
      {/* Light mode: dark logo on light background */}
      <Image
        src="/logo-light.png"
        alt="SAM Plan AI"
        width={width}
        height={height}
        priority
        className={cn("brand-logo-light rounded-[var(--radius-sm)]", className)}
      />
      {/* Dark mode: light logo on dark background */}
      <Image
        src="/logo-dark.png"
        alt="SAM Plan AI"
        width={width}
        height={height}
        priority
        className={cn("brand-logo-dark rounded-[var(--radius-sm)]", className)}
      />
    </>
  );
}
