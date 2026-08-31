"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

interface ImpersonationState {
  /** The company ID being impersonated (null = normal mode) */
  impersonatedCompanyId: string | null;
  /** The company name (for display in the banner) */
  impersonatedCompanyName: string | null;
  /** Start impersonating a company */
  startImpersonation: (companyId: string, companyName: string) => void;
  /** Stop impersonation and return to admin view */
  stopImpersonation: () => void;
  /** Is the admin currently impersonating? */
  isImpersonating: boolean;
}

const ImpersonationContext = createContext<ImpersonationState>({
  impersonatedCompanyId: null,
  impersonatedCompanyName: null,
  startImpersonation: () => {},
  stopImpersonation: () => {},
  isImpersonating: false,
});

const STORAGE_KEY = "sam-admin-impersonate";

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);

  // Load from sessionStorage on mount
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const { id, name } = JSON.parse(stored);
        console.log("[Impersonation] Restored session:", name, id);
        setCompanyId(id);
        setCompanyName(name);
      }
    } catch {}
  }, []);

  const startImpersonation = (id: string, name: string) => {
    console.log("[Impersonation] Starting:", name, id);
    setCompanyId(id);
    setCompanyName(name);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ id, name }));
  };

  const stopImpersonation = () => {
    console.log("[Impersonation] Stopping");
    setCompanyId(null);
    setCompanyName(null);
    sessionStorage.removeItem(STORAGE_KEY);
  };

  return (
    <ImpersonationContext.Provider
      value={{
        impersonatedCompanyId: companyId,
        impersonatedCompanyName: companyName,
        startImpersonation,
        stopImpersonation,
        isImpersonating: !!companyId,
      }}
    >
      {children}
    </ImpersonationContext.Provider>
  );
}

export function useImpersonation() {
  return useContext(ImpersonationContext);
}
