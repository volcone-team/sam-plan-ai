"use client";

import { useState, useEffect, useRef } from "react";
import { Upload, FileSpreadsheet, Trash2, ChevronDown, ChevronUp, AlertCircle, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "sam-flow-admin-workbook";

interface SheetData {
  name: string;
  headers: string[];
  rows: string[][];
  rowCount: number;
}

interface WorkbookData {
  fileName: string;
  uploadedAt: string;
  sheets: SheetData[];
  totalSheets: number;
}

function loadWorkbook(): WorkbookData | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return null;
}

function saveWorkbook(data: WorkbookData): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function deleteWorkbook(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function WorkbookUpload() {
  const [workbook, setWorkbook] = useState<WorkbookData | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSheet, setExpandedSheet] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Try API first, fall back to localStorage
    async function loadFromAPI() {
      try {
        console.log("[WorkbookUpload] Loading from API...");
        const res = await fetch("/api/admin/workbook");
        if (res.ok) {
          const json = await res.json();
          if (json.workbook) {
            console.log("[WorkbookUpload] Loaded from DB:", json.workbook.fileName, "sheets:", json.workbook.totalSheets);
            setWorkbook({
              fileName: json.workbook.fileName,
              uploadedAt: json.workbook.uploadedAt,
              sheets: json.workbook.sheets,
              totalSheets: json.workbook.totalSheets,
            });
            return;
          }
        }
      } catch (err) {
        console.log("[WorkbookUpload] API load failed, using localStorage:", err);
      }
      // Fallback to localStorage
      const local = loadWorkbook();
      if (local) console.log("[WorkbookUpload] Loaded from localStorage:", local.fileName);
      setWorkbook(local);
    }
    loadFromAPI();
  }, []);

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const validTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ];
    const isValid = validTypes.includes(file.type) || file.name.endsWith(".xlsx") || file.name.endsWith(".xls") || file.name.endsWith(".csv");

    if (!isValid) {
      setError("Please upload an Excel file (.xlsx, .xls) or CSV.");
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      setError("File too large. Maximum 20MB.");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const sheets = await parseExcel(arrayBuffer);

      if (sheets.length === 0) {
        setError("Could not parse any sheets from this file.");
        setUploading(false);
        return;
      }

      const data: WorkbookData = {
        fileName: file.name,
        uploadedAt: new Date().toISOString(),
        sheets,
        totalSheets: sheets.length,
      };

      // Save to Supabase via API
      console.log("[WorkbookUpload] Saving to API:", file.name, "sheets:", sheets.length);
      try {
        const res = await fetch("/api/admin/workbook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, sheets }),
        });
        const json = await res.json();
        if (!res.ok) {
          console.error("[WorkbookUpload] API save error:", json.error);
          setError("Saved locally but failed to sync: " + json.error);
        } else {
          console.log("[WorkbookUpload] Saved to DB:", json.workbook?.id);
        }
      } catch (apiErr) {
        console.error("[WorkbookUpload] API call failed:", apiErr);
        // Non-fatal — still save locally
      }

      saveWorkbook(data);
      setWorkbook(data);
    } catch (err) {
      console.error("Excel parse error:", err);
      setError("Failed to parse Excel file. It may be corrupted or in an unsupported format.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function parseExcel(arrayBuffer: ArrayBuffer): Promise<SheetData[]> {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(arrayBuffer, { type: "array" });

    const sheets: SheetData[] = [];

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const jsonData: string[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

      if (jsonData.length === 0) continue;

      const headers = jsonData[0].map(String);
      const rows = jsonData.slice(1).map(row => row.map(String));

      sheets.push({
        name: sheetName,
        headers,
        rows: rows.slice(0, 50), // Store first 50 rows for preview
        rowCount: rows.length,
      });
    }

    return sheets;
  }

  function handleDelete() {
    console.log("[WorkbookUpload] Deleting workbook...");
    deleteWorkbook();
    setWorkbook(null);
    // Also delete from DB
    fetch("/api/admin/workbook", { method: "DELETE" })
      .then(res => {
        if (res.ok) console.log("[WorkbookUpload] Deleted from DB");
        else console.error("[WorkbookUpload] DB delete failed");
      })
      .catch(err => console.error("[WorkbookUpload] DB delete error:", err));
    setExpandedSheet(null);
  }

  function getSheetMapping(sheetName: string): string {
    const lower = sheetName.toLowerCase();
    if (lower.includes("initiative")) return "→ Initiative Library";
    if (lower.includes("benchmark")) return "→ Benchmark Data";
    if (lower.includes("context") || lower.includes("ai")) return "→ AI System Prompt";
    if (lower.includes("template") || lower.includes("task") || lower.includes("project")) return "→ Project Templates";
    if (lower.includes("revenue") || lower.includes("projection") || lower.includes("rule")) return "→ Revenue Projections";
    return "→ Knowledge Base";
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-[hsl(var(--primary))]" />
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">AI Workbook (Excel Upload)</h3>
        </div>
        {workbook && (
          <span className="text-xs text-green-600 dark:text-green-400 font-medium">
            ✓ {workbook.totalSheets} sheets loaded
          </span>
        )}
      </div>

      <div className="p-4 space-y-3">
        {error && (
          <div className="flex items-center gap-2 rounded-md bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/30 px-3 py-2">
            <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
            <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {workbook ? (
          <div className="space-y-3">
            {/* File info */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                  <FileSpreadsheet className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[hsl(var(--foreground))]">{workbook.fileName}</p>
                  <p className="text-xs text-[hsl(var(--foreground-muted))]">
                    {workbook.totalSheets} sheets · Uploaded {new Date(workbook.uploadedAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDelete}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </button>
              </div>
            </div>

            {/* Sheet list */}
            <div className="space-y-2">
              {workbook.sheets.map(sheet => (
                <div key={sheet.name} className="rounded-md border border-border overflow-hidden">
                  <button
                    onClick={() => setExpandedSheet(expandedSheet === sheet.name ? null : sheet.name)}
                    className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-[hsl(var(--foreground)/0.02)] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Table2 className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
                      <span className="text-sm font-medium text-[hsl(var(--foreground))]">{sheet.name}</span>
                      <span className="text-xs text-[hsl(var(--foreground-muted))]">({sheet.rowCount} rows)</span>
                      <span className="text-xs text-[hsl(var(--primary))]">{getSheetMapping(sheet.name)}</span>
                    </div>
                    {expandedSheet === sheet.name ? (
                      <ChevronUp className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
                    )}
                  </button>

                  {expandedSheet === sheet.name && (
                    <div className="border-t border-border px-3 py-2 bg-[hsl(var(--foreground)/0.02)] overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr>
                            {sheet.headers.slice(0, 8).map((h, i) => (
                              <th key={i} className="px-2 py-1 text-left font-medium text-[hsl(var(--foreground-muted))] whitespace-nowrap">
                                {h || `Col ${i + 1}`}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sheet.rows.slice(0, 5).map((row, ri) => (
                            <tr key={ri} className="border-t border-border/50">
                              {row.slice(0, 8).map((cell, ci) => (
                                <td key={ci} className="px-2 py-1 text-[hsl(var(--foreground))] whitespace-nowrap max-w-[150px] truncate">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {sheet.rowCount > 5 && (
                        <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
                          ... and {sheet.rowCount - 5} more rows
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Info */}
            <div className="rounded-md bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/30 px-3 py-2">
              <p className="text-xs text-blue-700 dark:text-blue-300">
                Each sheet&apos;s content is used as AI context during plan generation. Sheet names are auto-mapped to system features.
              </p>
            </div>

            {/* Re-upload */}
            <label className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs font-medium text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--foreground-muted))] cursor-pointer transition-colors">
              <Upload className="h-3.5 w-3.5" />
              Upload new version
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>
        ) : (
          <label
            className={cn(
              "flex flex-col items-center justify-center rounded-[var(--radius-lg)] border-2 border-dashed px-6 py-8 cursor-pointer transition-colors",
              uploading
                ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.05)]"
                : "border-border hover:border-[hsl(var(--primary)/0.5)] hover:bg-[hsl(var(--foreground)/0.02)]"
            )}
          >
            {uploading ? (
              <>
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
                <p className="mt-3 text-sm font-medium text-[hsl(var(--foreground))]">Parsing sheets...</p>
              </>
            ) : (
              <>
                <FileSpreadsheet className="h-8 w-8 text-[hsl(var(--foreground-muted))]" />
                <p className="mt-3 text-sm font-medium text-[hsl(var(--foreground))]">Upload AI Workbook (.xlsx)</p>
                <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))] text-center max-w-sm">
                  Upload your Google Sheet exported as .xlsx. Each sheet tab (Initiatives, Benchmarks, AI Context, etc.) will be parsed and used as AI knowledge base.
                </p>
                <p className="mt-2 text-xs text-[hsl(var(--foreground-muted))]">.xlsx, .xls, or .csv · Max 20MB</p>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              className="hidden"
              disabled={uploading}
            />
          </label>
        )}
      </div>
    </div>
  );
}
