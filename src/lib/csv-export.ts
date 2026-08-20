/**
 * CSV Export Utility
 *
 * Generates a CSV file from headers and rows, then triggers a browser download.
 * Handles proper escaping of values containing commas, quotes, and newlines.
 */

function escapeCSVValue(value: string): string {
  // If the value contains a comma, double quote, or newline, wrap it in quotes
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    // Escape double quotes by doubling them
    const escaped = value.replace(/"/g, '""');
    return `"${escaped}"`;
  }
  return value;
}

/**
 * Generates CSV content and triggers a browser download.
 *
 * @param filename - The name of the downloaded file (should end in .csv)
 * @param headers - Array of column header strings
 * @param rows - 2D array of row data (each inner array is one row)
 */
export function exportToCSV(filename: string, headers: string[], rows: string[][]): void {
  // Build CSV content
  const headerLine = headers.map(escapeCSVValue).join(',');
  const dataLines = rows.map(row => row.map(escapeCSVValue).join(','));
  const csvContent = [headerLine, ...dataLines].join('\n');

  // Create blob and trigger download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up the object URL
  URL.revokeObjectURL(url);
}
