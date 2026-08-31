-- ============================================================
-- Workbook Data table
-- Stores parsed Excel workbook data uploaded by admin.
-- Single global record (not per-company).
-- Used to inject benchmarks/context into AI plan generation.
-- ============================================================

CREATE TABLE workbook_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_name TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_sheets INT NOT NULL DEFAULT 0,
  sheets JSONB NOT NULL DEFAULT '[]',
  -- Each sheet: { name: string, headers: string[], rows: string[][], rowCount: number }
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: Only admins can read/write
ALTER TABLE workbook_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view workbook data"
  ON workbook_data FOR SELECT
  USING (is_admin());

CREATE POLICY "Admins can insert workbook data"
  ON workbook_data FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update workbook data"
  ON workbook_data FOR UPDATE
  USING (is_admin());

CREATE POLICY "Admins can delete workbook data"
  ON workbook_data FOR DELETE
  USING (is_admin());
