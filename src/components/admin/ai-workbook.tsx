"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Save,
  Play,
  History,
  RotateCcw,
  Sparkles,
  Settings2,
  FileCode2,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkbookUpload } from "./workbook-upload";

// Alias for inline usage
const WorkbookUploadSection = WorkbookUpload;

/* ------------------------------------------------------------------
   Types
   ------------------------------------------------------------------ */

interface Prompt {
  id: string;
  name: string;
  description: string;
  content: string;
  model: "claude-sonnet-4" | "claude-opus";
  temperature: number;
  maxTokens: number;
}

interface Version {
  id: string;
  timestamp: string;
  content: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

interface StorageData {
  prompts: Prompt[];
  versions: Record<string, Version[]>;
}

/* ------------------------------------------------------------------
   Default Data
   ------------------------------------------------------------------ */

const DEFAULT_PROMPTS: Prompt[] = [
  {
    id: "initiative-generator",
    name: "Initiative Generator",
    description: "Main prompt for generating initiatives from questionnaire answers",
    content: `You are the SAM Plan AI initiative generator. Based on the user's questionnaire answers, select 6-10 initiatives from the available library that best match their business.

RULES:
- Match difficulty to user's team size, budget, and timeframe
- Favor channels the user has proven success with (from "what's worked")
- Never recommend initiatives requiring budget the user doesn't have
- Include a mix of quick-win (fast time-to-results) and high-ceiling initiatives
- Size traffic/registrant projections realistically based on user's current assets

OUTPUT: Return a JSON array of initiatives matching the Initiative schema.`,
    model: "claude-sonnet-4",
    temperature: 0.3,
    maxTokens: 4096,
  },
  {
    id: "plan-refinement",
    name: "Plan Refinement",
    description: "Used when users adjust their plan",
    content: `You are the SAM Plan AI plan refinement assistant. The user has an existing plan and wants to adjust it.

RULES:
- Respect the user's stated preferences and constraints
- When removing an initiative, suggest a replacement if possible
- Keep the total initiative count between 5-12
- Recalculate projections when initiatives change
- Maintain a balanced mix of difficulty levels

OUTPUT: Return the updated plan JSON with adjusted initiatives and projections.`,
    model: "claude-sonnet-4",
    temperature: 0.3,
    maxTokens: 4096,
  },
  {
    id: "revenue-projections",
    name: "Revenue Projections",
    description: "Calculates Good/Better/Best scenarios",
    content: `You are the SAM Plan AI revenue projection calculator. Based on the user's selected initiatives and business context, calculate three revenue scenarios.

RULES:
- Good scenario: Conservative, assumes 60% of projected results
- Better scenario: Expected, assumes 85% of projected results  
- Best scenario: Optimistic, assumes 110% of projected results
- Base projections on industry benchmarks and user's current assets
- Account for seasonality and ramp-up time
- Show monthly breakdown for 12 months

OUTPUT: Return a JSON object with good/better/best scenarios, each containing monthly revenue arrays.`,
    model: "claude-sonnet-4",
    temperature: 0.2,
    maxTokens: 4096,
  },
  {
    id: "weekly-insights",
    name: "Weekly Insights",
    description: "Generates weekly accountability insights",
    content: `You are the SAM Plan AI weekly insights generator. Based on the user's actual performance data vs their plan, generate actionable weekly insights.

RULES:
- Compare actuals to projected targets
- Highlight wins (outperforming) and areas needing attention
- Provide 2-3 specific, actionable recommendations
- Keep tone encouraging but data-driven
- Reference specific initiatives by name

OUTPUT: Return a JSON object with insights array, each having title, body, type (win/attention/tip), and related initiative ID.`,
    model: "claude-sonnet-4",
    temperature: 0.4,
    maxTokens: 2048,
  },
  {
    id: "recommendations",
    name: "Recommendations",
    description: "Suggests optimizations based on actuals",
    content: `You are the SAM Plan AI recommendations engine. Based on the user's actual performance data over time, suggest plan optimizations.

RULES:
- Identify underperforming initiatives (< 50% of target for 3+ weeks)
- Suggest budget reallocation from low to high performers
- Recommend new initiatives if current mix isn't achieving goals
- Consider seasonal factors and market trends
- Limit to 3-5 recommendations per cycle

OUTPUT: Return a JSON array of recommendations with type (swap/boost/add/pause), reasoning, and expected impact.`,
    model: "claude-sonnet-4",
    temperature: 0.3,
    maxTokens: 2048,
  },
];

const STORAGE_KEY = "sam-flow-admin-prompts";

/* ------------------------------------------------------------------
   Output Schemas
   ------------------------------------------------------------------ */

const OUTPUT_SCHEMAS: Record<string, string> = {
  "initiative-generator": JSON.stringify({
    type: "array",
    items: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        category: { type: "string", enum: ["paid-ads", "content", "email", "social", "seo", "events", "partnerships", "referral"] },
        difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
        timeToResults: { type: "string" },
        monthlyBudget: { type: "number" },
        projectedTraffic: { type: "number" },
        projectedRevenue: { type: "number" },
        tasks: { type: "array", items: { type: "object", properties: { title: { type: "string" }, week: { type: "number" } } } },
      },
      required: ["id", "name", "category", "difficulty", "timeToResults"],
    },
  }, null, 2),
  "plan-refinement": JSON.stringify({
    type: "object",
    properties: {
      initiatives: { type: "array", items: { "$ref": "#/definitions/Initiative" } },
      removedIds: { type: "array", items: { type: "string" } },
      addedIds: { type: "array", items: { type: "string" } },
      reasoning: { type: "string" },
    },
    required: ["initiatives", "reasoning"],
  }, null, 2),
  "revenue-projections": JSON.stringify({
    type: "object",
    properties: {
      good: { type: "object", properties: { monthly: { type: "array", items: { type: "number" } }, total: { type: "number" } } },
      better: { type: "object", properties: { monthly: { type: "array", items: { type: "number" } }, total: { type: "number" } } },
      best: { type: "object", properties: { monthly: { type: "array", items: { type: "number" } }, total: { type: "number" } } },
    },
    required: ["good", "better", "best"],
  }, null, 2),
  "weekly-insights": JSON.stringify({
    type: "object",
    properties: {
      insights: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            body: { type: "string" },
            type: { type: "string", enum: ["win", "attention", "tip"] },
            initiativeId: { type: "string" },
          },
          required: ["title", "body", "type"],
        },
      },
    },
    required: ["insights"],
  }, null, 2),
  "recommendations": JSON.stringify({
    type: "array",
    items: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["swap", "boost", "add", "pause"] },
        initiativeId: { type: "string" },
        reasoning: { type: "string" },
        expectedImpact: { type: "string" },
      },
      required: ["type", "reasoning", "expectedImpact"],
    },
  }, null, 2),
};

/* ------------------------------------------------------------------
   Mock Test Output
   ------------------------------------------------------------------ */

const MOCK_TEST_OUTPUT: Record<string, string> = {
  "initiative-generator": JSON.stringify([
    {
      id: "init-google-ads",
      name: "Google Ads - Search Campaign",
      category: "paid-ads",
      difficulty: "medium",
      timeToResults: "2-4 weeks",
      monthlyBudget: 2000,
      projectedTraffic: 1500,
      projectedRevenue: 8500,
      tasks: [
        { title: "Keyword research & ad group setup", week: 1 },
        { title: "Write ad copy & set up landing pages", week: 1 },
        { title: "Launch campaign & monitor", week: 2 },
        { title: "Optimize bids & negative keywords", week: 3 },
      ],
    },
    {
      id: "init-email-nurture",
      name: "Email Nurture Sequence",
      category: "email",
      difficulty: "easy",
      timeToResults: "1-2 weeks",
      monthlyBudget: 200,
      projectedTraffic: 0,
      projectedRevenue: 3200,
      tasks: [
        { title: "Map customer journey stages", week: 1 },
        { title: "Write 5-email welcome sequence", week: 1 },
        { title: "Set up automation triggers", week: 2 },
      ],
    },
  ], null, 2),
  "plan-refinement": JSON.stringify({
    initiatives: ["(updated initiative array)"],
    removedIds: ["init-tiktok-ads"],
    addedIds: ["init-linkedin-outreach"],
    reasoning: "Replaced TikTok ads with LinkedIn outreach since user's B2B audience is better reached on LinkedIn.",
  }, null, 2),
  "revenue-projections": JSON.stringify({
    good: { monthly: [2100, 2800, 3500, 4200, 5000, 5800, 6500, 7200, 7800, 8400, 9000, 9500], total: 71800 },
    better: { monthly: [3000, 4100, 5200, 6300, 7500, 8700, 9800, 10900, 11800, 12700, 13500, 14200], total: 107700 },
    best: { monthly: [3800, 5300, 6800, 8400, 10000, 11600, 13100, 14500, 15800, 17000, 18100, 19100], total: 143500 },
  }, null, 2),
  "weekly-insights": JSON.stringify({
    insights: [
      { title: "Email open rates up 12%", body: "Your nurture sequence is outperforming projections. Consider adding a 6th email to the sequence.", type: "win", initiativeId: "init-email-nurture" },
      { title: "Google Ads CPC rising", body: "Cost per click has increased 18% this week. Review negative keywords and consider tightening geo-targeting.", type: "attention", initiativeId: "init-google-ads" },
      { title: "Try A/B testing subject lines", body: "With your growing email list, you have enough volume to run meaningful A/B tests on subject lines.", type: "tip", initiativeId: "init-email-nurture" },
    ],
  }, null, 2),
  "recommendations": JSON.stringify([
    { type: "boost", initiativeId: "init-email-nurture", reasoning: "Email nurture is converting at 2x projected rate. Increase list growth budget.", expectedImpact: "+$1,500/mo revenue" },
    { type: "pause", initiativeId: "init-tiktok-ads", reasoning: "TikTok ads underperforming for 4 weeks. Audience mismatch for B2B product.", expectedImpact: "Save $800/mo budget" },
    { type: "add", initiativeId: "init-webinar", reasoning: "Based on your content engagement, live events would convert well.", expectedImpact: "+$2,200/mo revenue" },
  ], null, 2),
};

const MOCK_TEST_INPUT = `{
  "revenueGoal": "$500,000 in 12 months",
  "products": [
    { "name": "Business Coaching Program", "price": 5000 },
    { "name": "Online Course", "price": 997 }
  ],
  "whatsWorked": "Email marketing, Google Ads, referral partnerships",
  "idealCustomer": "Small business owners, 2-10 employees, $500K-$2M revenue",
  "currentAssets": { "emailList": 2500, "monthlyTraffic": 8000, "socialFollowing": 4200 },
  "budgetAndTeam": { "monthlyBudget": 5000, "teamSize": 2 },
  "obstacles": "Limited time, tried Facebook ads with poor results"
}`;

/* ------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------ */

function loadData(): StorageData {
  if (typeof window === "undefined") return { prompts: DEFAULT_PROMPTS, versions: {} };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as StorageData;
      if (parsed.prompts && Array.isArray(parsed.prompts) && parsed.prompts.length > 0) {
        return parsed;
      }
    }
  } catch {
    // fall through
  }
  return { prompts: DEFAULT_PROMPTS, versions: {} };
}

function saveData(data: StorageData): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = d.getHours();
  const min = String(d.getMinutes()).padStart(2, '0');
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 || 12;
  return `${month}/${day}/${d.getFullYear()} ${h}:${min} ${ampm}`;
}

/* ------------------------------------------------------------------
   Sub-Components
   ------------------------------------------------------------------ */

function PromptListItem({
  prompt,
  isActive,
  onClick,
}: {
  prompt: Prompt;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3 border-b border-border transition-colors",
        isActive
          ? "bg-[hsl(var(--primary)/0.08)] border-l-2 border-l-[hsl(var(--primary))]"
          : "hover:bg-[hsl(var(--foreground)/0.03)]"
      )}
    >
      <p className={cn(
        "text-sm font-medium truncate",
        isActive ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--foreground))]"
      )}>
        {prompt.name}
      </p>
      <p className="text-xs text-[hsl(var(--foreground-muted))] truncate mt-0.5">
        {prompt.description}
      </p>
    </button>
  );
}

function VersionHistory({
  versions,
  onRestore,
}: {
  versions: Version[];
  onRestore: (version: Version) => void;
}) {
  if (versions.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <History className="h-8 w-8 mx-auto text-[hsl(var(--foreground-muted)/0.4)] mb-2" />
        <p className="text-sm text-[hsl(var(--foreground-muted))]">No versions yet</p>
        <p className="text-xs text-[hsl(var(--foreground-muted)/0.7)] mt-1">
          Versions are created each time you save
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border max-h-[300px] overflow-y-auto">
      {versions.map((version) => (
        <div
          key={version.id}
          className="px-4 py-3 flex items-center justify-between gap-2 hover:bg-[hsl(var(--foreground)/0.02)] transition-colors"
        >
          <div className="min-w-0">
            <p className="text-xs font-medium text-[hsl(var(--foreground))]">
              {formatTimestamp(version.timestamp)}
            </p>
            <p className="text-xs text-[hsl(var(--foreground-muted))] truncate">
              {version.model} · temp {version.temperature} · {version.maxTokens} tokens
            </p>
          </div>
          <button
            onClick={() => onRestore(version)}
            className="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.08)] transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Restore
          </button>
        </div>
      ))}
    </div>
  );
}

function TestPlayground({
  promptId,
  onClose,
}: {
  promptId: string;
  onClose: () => void;
}) {
  const [input, setInput] = useState(MOCK_TEST_INPUT);
  const [output, setOutput] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  function handleRun() {
    setRunning(true);
    setOutput(null);
    // Simulate AI processing delay
    setTimeout(() => {
      setOutput(MOCK_TEST_OUTPUT[promptId] || '{ "message": "No mock output available for this prompt" }');
      setRunning(false);
    }, 1500);
  }

  return (
    <div className="border border-border rounded-[var(--radius-lg)] bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-[hsl(var(--foreground)/0.02)]">
        <div className="flex items-center gap-2">
          <Play className="h-4 w-4 text-[hsl(var(--primary))]" />
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Test Playground</h3>
        </div>
        <button
          onClick={onClose}
          className="text-xs text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          Close
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Status Notice */}
        <div className="flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 px-3 py-2">
          <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="text-xs text-amber-700 dark:text-amber-300">
            AI not connected — showing example output
          </p>
        </div>

        {/* Input */}
        <div>
          <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
            Sample Input (questionnaire answers)
          </label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={8}
            className="w-full rounded-md border border-border bg-[hsl(var(--foreground)/0.03)] px-3 py-2 text-xs font-mono text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] resize-none"
          />
        </div>

        {/* Run Button */}
        <button
          onClick={handleRun}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {running ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Running...
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5" />
              Run Test
            </>
          )}
        </button>

        {/* Output */}
        {output && (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="text-xs font-medium text-[hsl(var(--foreground-muted))]">
                Output (mock)
              </label>
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            </div>
            <pre className="w-full rounded-md border border-border bg-[hsl(var(--foreground)/0.03)] px-3 py-2 text-xs font-mono text-[hsl(var(--foreground))] overflow-x-auto max-h-[300px] overflow-y-auto">
              {output}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function OutputSchemaPanel({ promptId }: { promptId: string }) {
  const schema = OUTPUT_SCHEMAS[promptId];
  if (!schema) return null;

  return (
    <div className="border border-border rounded-[var(--radius-lg)] bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-[hsl(var(--foreground)/0.02)]">
        <FileCode2 className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
        <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Output Schema</h3>
        <span className="text-xs text-[hsl(var(--foreground-muted))]">(read-only)</span>
      </div>
      <pre className="px-4 py-3 text-xs font-mono text-[hsl(var(--foreground))] overflow-x-auto max-h-[250px] overflow-y-auto bg-[hsl(var(--foreground)/0.02)]">
        {schema}
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------
   Main Component
   ------------------------------------------------------------------ */

export function AIWorkbook() {
  const [data, setData] = useState<StorageData>({ prompts: DEFAULT_PROMPTS, versions: {} });
  const [activePromptId, setActivePromptId] = useState<string>(DEFAULT_PROMPTS[0].id);
  const [editContent, setEditContent] = useState("");
  const [editModel, setEditModel] = useState<"claude-sonnet-4" | "claude-opus">("claude-sonnet-4");
  const [editTemperature, setEditTemperature] = useState(0.3);
  const [editMaxTokens, setEditMaxTokens] = useState(4096);
  const [showVersions, setShowVersions] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");
  const [mounted, setMounted] = useState(false);
  const [mobilePromptOpen, setMobilePromptOpen] = useState(false);

  // Load from localStorage
  useEffect(() => {
    const loaded = loadData();
    setData(loaded);
    setMounted(true);
  }, []);

  // Sync editor state when active prompt changes
  useEffect(() => {
    const prompt = data.prompts.find((p) => p.id === activePromptId);
    if (prompt) {
      setEditContent(prompt.content);
      setEditModel(prompt.model);
      setEditTemperature(prompt.temperature);
      setEditMaxTokens(prompt.maxTokens);
    }
  }, [activePromptId, data.prompts]);

  const activePrompt = data.prompts.find((p) => p.id === activePromptId);
  const activeVersions = data.versions[activePromptId] || [];

  const handleSave = useCallback(() => {
    const newVersion: Version = {
      id: `v-${Date.now()}`,
      timestamp: new Date().toISOString(),
      content: editContent,
      model: editModel,
      temperature: editTemperature,
      maxTokens: editMaxTokens,
    };

    const updatedPrompts = data.prompts.map((p) =>
      p.id === activePromptId
        ? { ...p, content: editContent, model: editModel, temperature: editTemperature, maxTokens: editMaxTokens }
        : p
    );

    const existingVersions = data.versions[activePromptId] || [];
    const updatedVersions = [newVersion, ...existingVersions].slice(0, 10);

    const newData: StorageData = {
      prompts: updatedPrompts,
      versions: { ...data.versions, [activePromptId]: updatedVersions },
    };

    setData(newData);
    saveData(newData);
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus("idle"), 2000);
  }, [activePromptId, data, editContent, editModel, editTemperature, editMaxTokens]);

  const handleRestore = useCallback((version: Version) => {
    setEditContent(version.content);
    setEditModel(version.model as "claude-sonnet-4" | "claude-opus");
    setEditTemperature(version.temperature);
    setEditMaxTokens(version.maxTokens);
    setShowVersions(false);
  }, []);

  if (!mounted) {
    return (
      <div className="flex items-center justify-center py-12">
        <Sparkles className="h-8 w-8 animate-pulse text-[hsl(var(--foreground-muted))]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Workbook Upload */}
      <WorkbookUploadSection />

      {/* Main Editor Area */}
      <div className="flex flex-col lg:flex-row gap-0 lg:gap-0 min-h-[calc(100vh-280px)]">
      {/* Mobile Prompt Selector */}
      <div className="lg:hidden mb-4">
        <button
          onClick={() => setMobilePromptOpen(!mobilePromptOpen)}
          className="w-full flex items-center justify-between rounded-[var(--radius-lg)] border border-border bg-card px-4 py-3"
        >
          <div>
            <p className="text-sm font-medium text-[hsl(var(--foreground))]">
              {activePrompt?.name}
            </p>
            <p className="text-xs text-[hsl(var(--foreground-muted))]">
              {activePrompt?.description}
            </p>
          </div>
          <ChevronRight className={cn("h-4 w-4 text-[hsl(var(--foreground-muted))] transition-transform", mobilePromptOpen && "rotate-90")} />
        </button>
        {mobilePromptOpen && (
          <div className="mt-2 rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden">
            {data.prompts.map((prompt) => (
              <PromptListItem
                key={prompt.id}
                prompt={prompt}
                isActive={prompt.id === activePromptId}
                onClick={() => {
                  setActivePromptId(prompt.id);
                  setMobilePromptOpen(false);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-[240px] shrink-0 border border-border rounded-[var(--radius-lg)] bg-card overflow-hidden self-start">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
            Prompts
          </h3>
        </div>
        <nav className="divide-y-0">
          {data.prompts.map((prompt) => (
            <PromptListItem
              key={prompt.id}
              prompt={prompt}
              isActive={prompt.id === activePromptId}
              onClick={() => setActivePromptId(prompt.id)}
            />
          ))}
        </nav>
      </aside>

      {/* Editor Panel */}
      <div className="flex-1 lg:ml-4 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">
              {activePrompt?.name}
            </h2>
            <p className="text-sm text-[hsl(var(--foreground-muted))]">
              {activePrompt?.description}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowVersions(!showVersions); setShowTest(false); }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors",
                showVersions
                  ? "bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--primary))] border-[hsl(var(--primary)/0.3)]"
                  : "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.03)]"
              )}
            >
              <History className="h-3.5 w-3.5" />
              Versions
            </button>
            <button
              onClick={() => { setShowTest(!showTest); setShowVersions(false); }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors",
                showTest
                  ? "bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--primary))] border-[hsl(var(--primary)/0.3)]"
                  : "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.03)]"
              )}
            >
              <Play className="h-3.5 w-3.5" />
              Test
            </button>
          </div>
        </div>

        {/* Model Configuration */}
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Settings2 className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Model Configuration</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Model */}
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
                Model
              </label>
              <select
                value={editModel}
                onChange={(e) => setEditModel(e.target.value as "claude-sonnet-4" | "claude-opus")}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
              >
                <option value="claude-sonnet-4">Claude Sonnet 4</option>
                <option value="claude-opus">Claude Opus</option>
              </select>
            </div>
            {/* Temperature */}
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
                Temperature: {editTemperature.toFixed(1)}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={editTemperature}
                onChange={(e) => setEditTemperature(parseFloat(e.target.value))}
                className="w-full accent-[hsl(var(--primary))]"
              />
              <div className="flex justify-between text-xs text-[hsl(var(--foreground-muted))]">
                <span>Precise</span>
                <span>Creative</span>
              </div>
            </div>
            {/* Max Tokens */}
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
                Max Tokens
              </label>
              <input
                type="number"
                value={editMaxTokens}
                onChange={(e) => setEditMaxTokens(parseInt(e.target.value) || 4096)}
                min={256}
                max={16384}
                step={256}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
              />
            </div>
          </div>
        </div>

        {/* Prompt Editor */}
        <div className="rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-[hsl(var(--foreground)/0.03)]">
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">System Prompt</h3>
            <span className="text-xs text-[hsl(var(--foreground-muted))]">
              {editContent.length} characters
            </span>
          </div>
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={14}
            className="w-full border-0 bg-[hsl(var(--foreground)/0.02)] px-4 py-3 text-sm font-mono text-[hsl(var(--foreground))] focus:outline-none resize-y min-h-[200px] placeholder:text-[hsl(var(--foreground-muted)/0.5)]"
            placeholder="Enter your system prompt here..."
          />
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <div className="flex items-center gap-2">
              {saveStatus === "saved" && (
                <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Saved
                </span>
              )}
            </div>
            <button
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </button>
          </div>
        </div>

        {/* Version History Panel */}
        {showVersions && (
          <div className="rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-[hsl(var(--foreground)/0.02)]">
              <History className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
              <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Version History</h3>
              <span className="text-xs text-[hsl(var(--foreground-muted))]">
                ({activeVersions.length}/10)
              </span>
            </div>
            <VersionHistory versions={activeVersions} onRestore={handleRestore} />
          </div>
        )}

        {/* Test Playground Panel */}
        {showTest && (
          <TestPlayground promptId={activePromptId} onClose={() => setShowTest(false)} />
        )}

        {/* Output Schema */}
        <OutputSchemaPanel promptId={activePromptId} />
      </div>
    </div>
    </div>
  );
}
