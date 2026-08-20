"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ChevronUp,
  ChevronDown,
  Plus,
  Trash2,
  Eye,
  X,
  Save,
  ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------
   Types
   ------------------------------------------------------------------ */

interface AdminQuestion {
  id: string;
  title: string;
  description: string;
  required: boolean;
  inQuickstart: boolean;
  order: number;
}

/* ------------------------------------------------------------------
   Default Data (from questionnaire-config)
   ------------------------------------------------------------------ */

const DEFAULT_QUESTIONS: AdminQuestion[] = [
  {
    id: "revenue-goal",
    title: "Revenue Goal",
    description: "What revenue are you aiming for, and over what period?",
    required: true,
    inQuickstart: true,
    order: 0,
  },
  {
    id: "products",
    title: "Products & Pricing",
    description: "Add your products or services, with pricing.",
    required: true,
    inQuickstart: true,
    order: 1,
  },
  {
    id: "what-works",
    title: "What's Worked",
    description:
      "Which marketing or sales initiatives have driven real results?",
    required: true,
    inQuickstart: true,
    order: 2,
  },
  {
    id: "ideal-customer",
    title: "Ideal Customer",
    description: "Describe who you're trying to reach.",
    required: true,
    inQuickstart: false,
    order: 3,
  },
  {
    id: "current-assets",
    title: "Current Assets",
    description:
      "What do you already have? Email list, social following, traffic.",
    required: true,
    inQuickstart: false,
    order: 4,
  },
  {
    id: "budget-team",
    title: "Budget & Team",
    description:
      "What's your monthly marketing budget, and who's on your team?",
    required: true,
    inQuickstart: false,
    order: 5,
  },
  {
    id: "obstacles",
    title: "Obstacles",
    description: "What's held you back, or what hasn't worked?",
    required: false,
    inQuickstart: false,
    order: 6,
  },
];

const STORAGE_KEY = "sam-flow-admin-questionnaire";

/* ------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------ */

function generateId(): string {
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadQuestions(): AdminQuestion[] {
  if (typeof window === "undefined") return DEFAULT_QUESTIONS;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as AdminQuestion[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // fall through
  }
  return DEFAULT_QUESTIONS;
}

function saveQuestions(questions: AdminQuestion[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(questions));
}

/* ------------------------------------------------------------------
   Sub-Components
   ------------------------------------------------------------------ */

function Badge({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant: "blue" | "green";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        variant === "blue" &&
          "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
        variant === "green" &&
          "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
      )}
    >
      {children}
    </span>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          checked
            ? "bg-[hsl(var(--primary))]"
            : "bg-[hsl(var(--foreground-muted)/0.3)]"
        )}
      >
        <span
          className={cn(
            "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-[3px]"
          )}
        />
      </button>
      <span className="text-sm text-[hsl(var(--foreground))]">{label}</span>
    </label>
  );
}

/* ------------------------------------------------------------------
   Edit Form (inline)
   ------------------------------------------------------------------ */

function EditForm({
  question,
  onSave,
  onCancel,
}: {
  question: AdminQuestion;
  onSave: (updated: AdminQuestion) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(question.title);
  const [description, setDescription] = useState(question.description);
  const [required, setRequired] = useState(question.required);
  const [inQuickstart, setInQuickstart] = useState(question.inQuickstart);

  function handleSave() {
    onSave({ ...question, title, description, required, inQuickstart });
  }

  return (
    <div className="border-t border-border bg-card/50 px-6 py-4 space-y-4">
      <div>
        <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
          Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] resize-none"
        />
      </div>
      <div className="flex flex-wrap gap-6">
        <Toggle label="Required" checked={required} onChange={setRequired} />
        <Toggle
          label="Include in Quickstart"
          checked={inQuickstart}
          onChange={setInQuickstart}
        />
      </div>
      <div className="flex gap-2 pt-2">
        <button
          onClick={handleSave}
          className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          <Save className="h-3.5 w-3.5" />
          Save
        </button>
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-[hsl(var(--foreground-muted))] hover:bg-card transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Add Question Form
   ------------------------------------------------------------------ */

function AddQuestionForm({
  onAdd,
  onCancel,
}: {
  onAdd: (q: AdminQuestion) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [required, setRequired] = useState(true);
  const [inQuickstart, setInQuickstart] = useState(false);

  function handleAdd() {
    if (!title.trim()) return;
    onAdd({
      id: generateId(),
      title: title.trim(),
      description: description.trim(),
      required,
      inQuickstart,
      order: 0, // will be set by parent
    });
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 space-y-4">
      <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">
        Add New Question
      </h3>
      <div>
        <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
          Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Target Audience"
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted)/0.5)] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="What should the user answer here?"
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted)/0.5)] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] resize-none"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
          Field Type
        </label>
        <select
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
          defaultValue="info"
          disabled
        >
          <option value="info">Info (text-based)</option>
        </select>
        <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
          Additional field types coming soon.
        </p>
      </div>
      <div className="flex flex-wrap gap-6">
        <Toggle label="Required" checked={required} onChange={setRequired} />
        <Toggle
          label="Include in Quickstart"
          checked={inQuickstart}
          onChange={setInQuickstart}
        />
      </div>
      <div className="flex gap-2 pt-2">
        <button
          onClick={handleAdd}
          disabled={!title.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Question
        </button>
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-[hsl(var(--foreground-muted))] hover:bg-card transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Preview Modal
   ------------------------------------------------------------------ */

function PreviewModal({
  questions,
  onClose,
}: {
  questions: AdminQuestion[];
  onClose: () => void;
}) {
  const quickstartQs = questions.filter((q) => q.inQuickstart);
  const fullOnlyQs = questions.filter((q) => !q.inQuickstart);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="relative mx-4 w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-[var(--radius-lg)] border border-border bg-card p-6 shadow-xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))] transition-colors"
          aria-label="Close preview"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] mb-1">
          Questionnaire Preview
        </h2>
        <p className="text-sm text-[hsl(var(--foreground-muted))] mb-6">
          How questions appear in each flow.
        </p>

        {/* Quickstart Section */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-3 flex items-center gap-2">
            <Badge variant="green">Quickstart</Badge>
            <span>{quickstartQs.length} questions</span>
          </h3>
          <ol className="space-y-3">
            {quickstartQs.map((q, i) => (
              <li
                key={q.id}
                className="rounded-md border border-border px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-100 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
                    {i + 1}
                  </span>
                  <span className="text-sm font-medium text-[hsl(var(--foreground))]">
                    {q.title}
                  </span>
                  {q.required && <Badge variant="blue">Required</Badge>}
                </div>
                <p className="mt-1 pl-7 text-xs text-[hsl(var(--foreground-muted))]">
                  {q.description}
                </p>
              </li>
            ))}
          </ol>
        </div>

        {/* Full Plan Only Section */}
        {fullOnlyQs.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-3 flex items-center gap-2">
              <span className="text-[hsl(var(--foreground-muted))]">
                Full Plan Only
              </span>
              <span className="text-[hsl(var(--foreground-muted))]">
                +{fullOnlyQs.length} questions
              </span>
            </h3>
            <ol
              className="space-y-3"
              start={quickstartQs.length + 1}
            >
              {fullOnlyQs.map((q, i) => (
                <li
                  key={q.id}
                  className="rounded-md border border-dashed border-border px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--foreground-muted)/0.1)] text-xs font-medium text-[hsl(var(--foreground-muted))]">
                      {quickstartQs.length + i + 1}
                    </span>
                    <span className="text-sm font-medium text-[hsl(var(--foreground))]">
                      {q.title}
                    </span>
                    {q.required && <Badge variant="blue">Required</Badge>}
                  </div>
                  <p className="mt-1 pl-7 text-xs text-[hsl(var(--foreground-muted))]">
                    {q.description}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Main Component
   ------------------------------------------------------------------ */

export function QuestionnaireManagement() {
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    setQuestions(loadQuestions());
    setMounted(true);
  }, []);

  // Auto-save on every change
  const persist = useCallback((updated: AdminQuestion[]) => {
    setQuestions(updated);
    saveQuestions(updated);
  }, []);

  // Reorder
  function moveUp(index: number) {
    if (index === 0) return;
    const updated = [...questions];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    updated.forEach((q, i) => (q.order = i));
    persist(updated);
  }

  function moveDown(index: number) {
    if (index === questions.length - 1) return;
    const updated = [...questions];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    updated.forEach((q, i) => (q.order = i));
    persist(updated);
  }

  // Edit
  function handleSaveEdit(updated: AdminQuestion) {
    const newList = questions.map((q) => (q.id === updated.id ? updated : q));
    persist(newList);
    setExpandedId(null);
  }

  // Add
  function handleAdd(newQ: AdminQuestion) {
    const updated = [...questions, { ...newQ, order: questions.length }];
    persist(updated);
    setShowAddForm(false);
  }

  // Delete
  function handleDelete(id: string) {
    if (questions.length <= 3) return;
    const updated = questions
      .filter((q) => q.id !== id)
      .map((q, i) => ({ ...q, order: i }));
    persist(updated);
    setDeleteConfirmId(null);
    if (expandedId === id) setExpandedId(null);
  }

  if (!mounted) {
    return (
      <div className="flex items-center justify-center py-12">
        <ClipboardList className="h-8 w-8 animate-pulse text-[hsl(var(--foreground-muted))]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setShowPreview(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-[hsl(var(--foreground))] hover:bg-card transition-colors"
        >
          <Eye className="h-4 w-4" />
          Preview
        </button>
        <span className="text-xs text-[hsl(var(--foreground-muted))]">
          {questions.length} questions &middot;{" "}
          {questions.filter((q) => q.inQuickstart).length} in Quickstart
        </span>
      </div>

      {/* Question List */}
      <div className="space-y-3">
        {questions.map((question, index) => (
          <div
            key={question.id}
            className="rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden"
          >
            {/* Question Card Header */}
            <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
              {/* Order Number */}
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary)/0.1)] text-xs font-semibold text-[hsl(var(--primary))]">
                {index + 1}
              </span>

              {/* Title + Description */}
              <button
                onClick={() =>
                  setExpandedId(expandedId === question.id ? null : question.id)
                }
                className="flex-1 text-left min-w-0"
              >
                <p className="text-sm font-medium text-[hsl(var(--foreground))] truncate">
                  {question.title}
                </p>
                <p className="text-xs text-[hsl(var(--foreground-muted))] truncate">
                  {question.description}
                </p>
              </button>

              {/* Badges */}
              <div className="hidden sm:flex items-center gap-2 shrink-0">
                {question.required && <Badge variant="blue">Required</Badge>}
                {question.inQuickstart && (
                  <Badge variant="green">Quickstart</Badge>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => moveUp(index)}
                  disabled={index === 0}
                  className="rounded p-1 text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label="Move up"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  onClick={() => moveDown(index)}
                  disabled={index === questions.length - 1}
                  className="rounded p-1 text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label="Move down"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  onClick={() =>
                    setDeleteConfirmId(
                      deleteConfirmId === question.id ? null : question.id
                    )
                  }
                  disabled={questions.length <= 3}
                  className="rounded p-1 text-[hsl(var(--foreground-muted))] hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label="Delete question"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Mobile Badges */}
            <div className="flex sm:hidden items-center gap-2 px-4 pb-2">
              {question.required && <Badge variant="blue">Required</Badge>}
              {question.inQuickstart && (
                <Badge variant="green">Quickstart</Badge>
              )}
            </div>

            {/* Delete Confirmation */}
            {deleteConfirmId === question.id && (
              <div className="border-t border-border bg-red-50 dark:bg-red-900/10 px-6 py-3 flex items-center justify-between">
                <span className="text-sm text-red-600 dark:text-red-400">
                  Delete this question?
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDelete(question.id)}
                    className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 transition-colors"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(null)}
                    className="rounded-md border border-border px-3 py-1 text-xs font-medium text-[hsl(var(--foreground-muted))] hover:bg-card transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Inline Edit Form */}
            {expandedId === question.id && (
              <EditForm
                question={question}
                onSave={handleSaveEdit}
                onCancel={() => setExpandedId(null)}
              />
            )}
          </div>
        ))}
      </div>

      {/* Add Question */}
      {showAddForm ? (
        <AddQuestionForm
          onAdd={handleAdd}
          onCancel={() => setShowAddForm(false)}
        />
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-4 py-2.5 text-sm font-medium text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--foreground-muted))] transition-colors w-full justify-center"
        >
          <Plus className="h-4 w-4" />
          Add Question
        </button>
      )}

      {/* Preview Modal */}
      {showPreview && (
        <PreviewModal
          questions={questions}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
}
