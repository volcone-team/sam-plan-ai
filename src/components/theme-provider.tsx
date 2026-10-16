"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Theme provider wrapping next-themes.
 * Supports light, dark, and system themes.
 * Applies theme class to <html> element.
 * Persists user preference in localStorage.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      /*
       * Silences React 19's dev warning "Encountered a script tag while
       * rendering React component", without breaking anything.
       *
       * next-themes renders an inline <script> that applies the theme class
       * before first paint, so there is no light/dark flash. That script does
       * its job from the SERVER-rendered HTML; the client-side copy is never
       * executed by the browser anyway, which is exactly what React warns
       * about.
       *
       * React skips the warning for non-executable "data block" scripts. So
       * the type is left unset on the server (the script must run there) and
       * set to application/json on the client (where it would not run
       * regardless). The resulting attribute difference is ignored during
       * hydration because next-themes sets suppressHydrationWarning on it.
       */
      scriptProps={{
        type: typeof window === "undefined" ? undefined : "application/json",
      }}
    >
      {children}
    </NextThemesProvider>
  );
}
