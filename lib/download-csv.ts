/** Browser-only CSV download. Safe for commas/quotes in cell values. */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: string[][]
): void {
  const escape = (cell: string) => `"${cell.replace(/"/g, '""')}"`;
  const csv = [headers.map(escape).join(",")]
    .concat(rows.map((row) => row.map(escape).join(",")))
    .join("\n");
  const a = document.createElement("a");
  a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  a.download = filename;
  a.click();
}
