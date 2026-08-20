'use client';

import { useState, useEffect } from 'react';
import { CheckCircle, Shield } from 'lucide-react';

const STORAGE_KEY = 'sam-flow-benchmark-settings';

export function BenchmarkSettings() {
  const [optedIn, setOptedIn] = useState(true);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      setOptedIn(JSON.parse(saved));
    }
  }, []);

  const handleToggle = () => {
    const newValue = !optedIn;
    setOptedIn(newValue);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newValue));
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 3000);
  };

  return (
    <div className="space-y-6">
      {/* Success Toast */}
      {showSuccess && (
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          <CheckCircle className="h-4 w-4" />
          Benchmark preference saved.
        </div>
      )}

      {/* Toggle Section */}
      <div className="flex items-center justify-between rounded-[var(--radius-lg)] border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-[hsl(var(--primary))]" />
          <div>
            <p className="font-medium text-sm">Contribute anonymized data to improve benchmarks for all users</p>
            <p className="text-xs text-[hsl(var(--foreground-muted))]">
              {optedIn ? 'Currently sharing anonymized data' : 'Data sharing is off'}
            </p>
          </div>
        </div>

        {/* Toggle Switch */}
        <button
          role="switch"
          aria-checked={optedIn}
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
            optedIn ? 'bg-[hsl(var(--primary))]' : 'bg-[hsl(var(--muted))]'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
              optedIn ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Explanation Section */}
      <div className="space-y-4 rounded-[var(--radius-lg)] border border-border bg-card p-6">
        <h3 className="font-semibold">How benchmark participation works</h3>

        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-medium text-[hsl(var(--primary))]">What we share</h4>
            <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
              Anonymized, aggregated conversion rates and outcomes (never individual business data).
            </p>
          </div>

          <div>
            <h4 className="text-sm font-medium text-[hsl(var(--primary))]">What we don&apos;t share</h4>
            <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
              Your company name, customer details, revenue figures, or any identifiable information.
            </p>
          </div>

          <div>
            <h4 className="text-sm font-medium text-[hsl(var(--primary))]">Why it matters</h4>
            <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
              More data = more accurate benchmarks = better plans for everyone.
            </p>
          </div>

          <div>
            <h4 className="text-sm font-medium text-[hsl(var(--primary))]">Your control</h4>
            <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
              Toggle off at any time. Your data will be excluded from future benchmark updates.
            </p>
          </div>
        </div>
      </div>

      {/* Privacy Link Placeholder */}
      <p className="text-xs text-[hsl(var(--foreground-muted))]">
        For more details, see our{' '}
        <span className="cursor-pointer text-[hsl(var(--primary))] hover:underline">
          Privacy Policy
        </span>
        .
      </p>
    </div>
  );
}
