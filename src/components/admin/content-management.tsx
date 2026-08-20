"use client";

import { useEffect, useState, useCallback } from "react";
import {
  GraduationCap,
  HelpCircle,
  Mail,
  Plus,
  ChevronDown,
  ChevronUp,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------
   Types
   ------------------------------------------------------------------ */

interface ContentItem {
  id: string;
  title: string;
  body: string;
  videoUrl?: string;
  createdAt: string;
}

type TabKey = "university" | "faq" | "emails";

interface TabConfig {
  key: TabKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  storageKey: string;
}

/* ------------------------------------------------------------------
   Constants
   ------------------------------------------------------------------ */

const TABS: TabConfig[] = [
  { key: "university", label: "University", icon: GraduationCap, storageKey: "sam-content-university" },
  { key: "faq", label: "FAQ", icon: HelpCircle, storageKey: "sam-content-faq" },
  { key: "emails", label: "Emails", icon: Mail, storageKey: "sam-content-emails" },
];

const MOCK_DATA: Record<TabKey, ContentItem[]> = {
  university: [
    { id: "uni-1", title: "Getting Started with SAM Flow", body: "Welcome to SAM Flow AI. This guide walks you through the basics of setting up your strategic account management workflow, from onboarding to your first initiative.", createdAt: "2025-01-15" },
    { id: "uni-2", title: "Understanding Initiative Types", body: "Learn about the different initiative types available in SAM Flow: retention programs, cross-sell campaigns, upsell strategies, and new product launches.", createdAt: "2025-01-20" },
    { id: "uni-3", title: "Building Your Annual Plan", body: "A step-by-step guide to constructing a comprehensive annual strategic plan using SAM Flow's planning tools and benchmarks.", createdAt: "2025-02-01" },
  ],
  faq: [
    { id: "faq-1", title: "How do I reset my password?", body: "Navigate to Settings > Account > Security and click 'Change Password'. You'll receive a verification email before the change takes effect.", createdAt: "2025-01-10" },
    { id: "faq-2", title: "What are benchmarks?", body: "Benchmarks are industry-standard performance metrics that SAM Flow uses to set realistic targets for your initiatives. They come from first-party data, published research, and partner networks.", createdAt: "2025-01-12" },
    { id: "faq-3", title: "Can I export my plan?", body: "Yes! Go to your Year at a Glance view and click the Export button in the top right. You can export as PDF or CSV.", createdAt: "2025-01-18" },
  ],
  emails: [
    { id: "email-1", title: "Welcome Email", body: "Subject: Welcome to SAM Flow AI\n\nHi {{name}},\n\nWelcome aboard! We're excited to have you. Your account is ready and your first step is to complete the onboarding questionnaire.", createdAt: "2025-01-05" },
    { id: "email-2", title: "Weekly Digest", body: "Subject: Your Weekly SAM Flow Summary\n\nHi {{name}},\n\nHere's your weekly progress update:\n- Initiatives active: {{count}}\n- Tasks completed: {{completed}}\n- Upcoming deadlines: {{deadlines}}", createdAt: "2025-01-08" },
    { id: "email-3", title: "Plan Generated Notification", body: "Subject: Your Strategic Plan is Ready\n\nHi {{name}},\n\nGreat news! Your annual strategic plan has been generated based on your questionnaire responses and industry benchmarks.", createdAt: "2025-01-14" },
  ],
};

/* ------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------ */

function loadItems(storageKey: string, fallback: ContentItem[]): ContentItem[] {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) return JSON.parse(stored);
  } catch {
    // ignore parse errors
  }
  return fallback;
}

function saveItems(storageKey: string, items: ContentItem[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey, JSON.stringify(items));
}

/* ------------------------------------------------------------------
   Main Component
   ------------------------------------------------------------------ */

export function ContentManagement() {
  const [activeTab, setActiveTab] = useState<TabKey>("university");

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-[hsl(var(--primary))] text-white"
                  : "text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--background))]"
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {TABS.map((tab) =>
        activeTab === tab.key ? (
          <ContentList key={tab.key} tabConfig={tab} />
        ) : null
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   Content List
   ------------------------------------------------------------------ */

function ContentList({ tabConfig }: { tabConfig: TabConfig }) {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    setItems(loadItems(tabConfig.storageKey, MOCK_DATA[tabConfig.key]));
  }, [tabConfig.storageKey, tabConfig.key]);

  const persist = useCallback(
    (updated: ContentItem[]) => {
      setItems(updated);
      saveItems(tabConfig.storageKey, updated);
    },
    [tabConfig.storageKey]
  );

  function handleAdd(title: string, body: string) {
    const newItem: ContentItem = {
      id: `${tabConfig.key}-${Date.now()}`,
      title,
      body,
      createdAt: new Date().toISOString().slice(0, 10),
    };
    persist([newItem, ...items]);
    setShowAddForm(false);
  }

  function handleUpdate(id: string, title: string, body: string, videoUrl?: string) {
    persist(items.map((item) => (item.id === id ? { ...item, title, body, videoUrl } : item)));
    setExpandedId(null);
  }

  function handleDelete(id: string) {
    persist(items.filter((item) => item.id !== id));
    if (expandedId === id) setExpandedId(null);
  }

  return (
    <div className="space-y-4">
      {/* Actions */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-[hsl(var(--foreground-muted))]">
          {items.length} item{items.length !== 1 ? "s" : ""}
        </p>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" />
          Add Item
        </button>
      </div>

      {/* Add Form */}
      {showAddForm && (
        <AddForm onAdd={handleAdd} onCancel={() => setShowAddForm(false)} />
      )}

      {/* Item List */}
      <div className="space-y-2">
        {items.map((item) => (
          <ContentItemRow
            key={item.id}
            item={item}
            isExpanded={expandedId === item.id}
            onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
          />
        ))}
        {items.length === 0 && (
          <div className="rounded-[var(--radius-lg)] border border-border bg-card p-8 text-center">
            <p className="text-sm text-[hsl(var(--foreground-muted))]">
              No items yet. Click &quot;Add Item&quot; to create one.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Content Item Row
   ------------------------------------------------------------------ */

interface ContentItemRowProps {
  item: ContentItem;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdate: (id: string, title: string, body: string, videoUrl?: string) => void;
  onDelete: (id: string) => void;
}

function ContentItemRow({ item, isExpanded, onToggle, onUpdate, onDelete }: ContentItemRowProps) {
  const [editTitle, setEditTitle] = useState(item.title);
  const [editBody, setEditBody] = useState(item.body);
  const [editVideoUrl, setEditVideoUrl] = useState(item.videoUrl || "");

  useEffect(() => {
    setEditTitle(item.title);
    setEditBody(item.body);
    setEditVideoUrl(item.videoUrl || "");
  }, [item.title, item.body, item.videoUrl, isExpanded]);

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden">
      {/* Header row */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[hsl(var(--background))] transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2 min-w-0">
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-[hsl(var(--foreground-muted))]" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-[hsl(var(--foreground-muted))]" />
          )}
          <span className="font-medium text-sm text-[hsl(var(--foreground))] truncate">
            {item.title}
          </span>
          {item.videoUrl && (
            <span className="shrink-0 inline-flex items-center rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
              Video
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-[hsl(var(--foreground-muted))]">
            {item.createdAt}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(item.id);
            }}
            className="text-red-500 hover:text-red-700 transition-colors p-1 rounded"
            aria-label="Delete item"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded edit form */}
      {isExpanded && (
        <div className="border-t border-border px-4 py-4 space-y-3 bg-[hsl(var(--background))]">
          <div>
            <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
              Title
            </label>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
              Content
            </label>
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] resize-y"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
              Video URL <span className="text-[hsl(var(--foreground-muted))]">(Wistia, YouTube, or Vimeo)</span>
            </label>
            <input
              type="url"
              value={editVideoUrl}
              onChange={(e) => setEditVideoUrl(e.target.value)}
              placeholder="https://fast.wistia.com/medias/..."
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
            />
            {editVideoUrl && (
              <p className="mt-1 text-xs text-green-600 dark:text-green-400">✓ Video linked</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onUpdate(item.id, editTitle, editBody, editVideoUrl)}
              className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </button>
            <button
              onClick={onToggle}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--background))] transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   Add Form
   ------------------------------------------------------------------ */

function AddForm({ onAdd, onCancel }: { onAdd: (title: string, body: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onAdd(title.trim(), body.trim());
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-[var(--radius-lg)] border border-border bg-card p-4 space-y-3"
    >
      <h4 className="text-sm font-semibold text-[hsl(var(--foreground))]">
        Add New Item
      </h4>
      <div>
        <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
          Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter title..."
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
          Content
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder="Enter content..."
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] resize-y"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--background))] transition-colors"
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </button>
      </div>
    </form>
  );
}
