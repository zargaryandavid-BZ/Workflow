/** Row shape for `column_archives` (column batches and single-order ZIPs). */
export interface StoredArchiveRow {
  id: string;
  tenant_id: string;
  column_id: string | null;
  column_name: string;
  order_id: string | null;
  order_title: string | null;
  storage_path: string | null;
  file_name: string | null;
  file_size: number | null;
  order_count: number;
  failure_count: number;
  status: "pending" | "ready" | "failed";
  error: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}
