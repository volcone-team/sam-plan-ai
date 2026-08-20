"use client";

import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

function subscribeMounted(callback: () => void) {
  // We only need to know when the component mounts (client-side)
  // Using a microtask to trigger after hydration
  const id = requestAnimationFrame(callback);
  return () => cancelAnimationFrame(id);
}

function getMounted() {
  return true;
}

function getServerMounted() {
  return false;
}

/**
 * Theme toggle button that cycles through light → dark → system.
 * Displays the current theme icon with accessible label.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribeMounted,
    getMounted,
    getServerMounted
  );

  if (!mounted) {
    return (
      <button
        type="button"
        className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-foreground"
        aria-label="Toggle theme"
      >
        <Sun className="h-4 w-4" />
      </button>
    );
  }

  const cycleTheme = () => {
    if (theme === "light") setTheme("dark");
    else if (theme === "dark") setTheme("system");
    else setTheme("light");
  };

  const label =
    theme === "light"
      ? "Switch to dark theme"
      : theme === "dark"
        ? "Switch to system theme"
        : "Switch to light theme";

  return (
    <button
      type="button"
      onClick={cycleTheme}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)]",
        "text-foreground hover:bg-accent",
        "transition-colors duration-[var(--duration-default)]"
      )}
    >
      {theme === "light" && <Sun className="h-4 w-4" />}
      {theme === "dark" && <Moon className="h-4 w-4" />}
      {theme === "system" && <Monitor className="h-4 w-4" />}
    </button>
  );
}
