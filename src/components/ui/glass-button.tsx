"use client";

import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  className?: string;
}

/**
 * Glass-effect button with animated glow orbs.
 * Light mode: green/teal glow. Dark mode: yellow/green glow.
 */
export function GlassButton({ children, className, ...props }: GlassButtonProps) {
  return (
    <button
      className={cn(
        "relative overflow-hidden inline-flex items-center justify-center gap-2",
        "rounded-[var(--radius-lg)] px-10 h-12 text-base font-medium",
        "bg-[hsl(210_60%_12%/0.85)] text-white",
        "border border-[hsla(180,30%,40%,0.3)]",
        "backdrop-blur-xl",
        "transition-all duration-300",
        "hover:border-[hsla(152,100%,40%,0.5)] hover:shadow-[0_0_20px_hsla(152,100%,40%,0.15)]",
        "dark:hover:border-[hsla(60,100%,60%,0.5)] dark:hover:shadow-[0_0_20px_hsla(60,100%,50%,0.2)]",
        className
      )}
      {...props}
    >
      {/* Glow orb 1 — green in light, yellow in dark */}
      <span
        className="absolute rounded-full animate-pulse pointer-events-none dark:hidden"
        style={{
          width: "50px",
          height: "50px",
          background: "radial-gradient(circle, #ACFFA7 0%, transparent 70%)",
          top: "50%",
          left: "20%",
          transform: "translate(-50%, -50%)",
          opacity: 0.5,
          filter: "blur(10px)",
        }}
        aria-hidden="true"
      />
      <span
        className="absolute rounded-full animate-pulse pointer-events-none hidden dark:block"
        style={{
          width: "50px",
          height: "50px",
          background: "radial-gradient(circle, #FFEE58 0%, transparent 70%)",
          top: "50%",
          left: "20%",
          transform: "translate(-50%, -50%)",
          opacity: 0.6,
          filter: "blur(10px)",
        }}
        aria-hidden="true"
      />
      {/* Glow orb 2 — teal in light, yellow-green in dark */}
      <span
        className="absolute rounded-full animate-pulse pointer-events-none dark:hidden"
        style={{
          width: "45px",
          height: "45px",
          background: "radial-gradient(circle, #48FFD6 0%, transparent 70%)",
          top: "50%",
          right: "15%",
          transform: "translate(50%, -50%)",
          opacity: 0.5,
          filter: "blur(10px)",
          animationDelay: "1.5s",
        }}
        aria-hidden="true"
      />
      <span
        className="absolute rounded-full animate-pulse pointer-events-none hidden dark:block"
        style={{
          width: "45px",
          height: "45px",
          background: "radial-gradient(circle, #ACFFA7 0%, transparent 70%)",
          top: "50%",
          right: "15%",
          transform: "translate(50%, -50%)",
          opacity: 0.6,
          filter: "blur(10px)",
          animationDelay: "1.5s",
        }}
        aria-hidden="true"
      />
      {/* Content sits above the glow */}
      <span className="relative z-10 flex items-center gap-2">{children}</span>
    </button>
  );
}
