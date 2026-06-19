export type Role =
  | "admin"
  | "preprod_owner"
  | "designer"
  | "account_manager"
  | "member";

export type ColumnKind = "normal" | "exception" | "approval" | "done";

export type CustomFieldType =
  | "text"
  | "number"
  | "select"
  | "date"
  | "checkbox";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type AutomationTrigger = "on_enter_column" | "on_approval_result";

export type NotificationType = "missing_info" | "customer_approval";

export type NotificationChannel = "email" | "sms" | "none" | "manual";

export type NotificationStatus = "pending" | "sent" | "responded" | "expired";

export type CustomerResponse =
  | "approved"
  | "changes_requested"
  | "info_submitted";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface Profile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at?: string;
}

/** Team member row for settings UI (memberships + profile + auth email). */
export interface TeamMemberRow {
  user_id: string;
  role: Role;
  created_at: string;
  profile: Profile | null;
  email: string | null;
  pending: boolean;
}

export interface Membership {
  user_id: string;
  tenant_id: string;
  role: Role;
  created_at: string;
}

export interface BoardColumn {
  id: string;
  tenant_id: string;
  name: string;
  position: number;
  kind: ColumnKind;
  color: string | null;
  image_url: string | null;
  /** Roles allowed to move an order INTO this column. null = everyone. */
  drop_in_roles: Role[] | null;
  /** Roles allowed to move an order OUT OF this column. null = everyone. */
  drop_out_roles: Role[] | null;
}

export interface Category {
  id: string;
  tenant_id: string;
  name: string;
  color: string;
  description: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  tenant_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  created_at: string;
  updated_at?: string;
}

export interface CustomerWithStats extends Customer {
  order_count: number;
  last_order_at: string | null;
}

export interface CustomerOrderSummary {
  id: string;
  title: string;
  created_at: string;
  column_id: string;
  column_name: string | null;
}

export interface OrderSpecs {
  size?: string;
  quantity?: number;
  stock?: string;
  finish?: string;
  color?: string;
  [key: string]: unknown;
}

export interface Order {
  id: string;
  tenant_id: string;
  column_id: string;
  customer_id: string | null;
  category_id: string | null;
  title: string;
  description: string | null;
  specs: OrderSpecs;
  priority: "low" | "normal" | "high" | "urgent";
  due_date: string | null;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomField {
  id: string;
  tenant_id: string;
  name: string;
  field_type: CustomFieldType;
  options: string[];
  position: number;
  required: boolean;
}

export interface CustomFieldValue {
  id: string;
  order_id: string;
  custom_field_id: string;
  value: unknown;
}

export interface Asset {
  id: string;
  tenant_id: string;
  order_id: string;
  /** When set, this file is artwork for the SKU with matching specs.skus[].id */
  sku_key: string | null;
  notification_id?: string | null;
  file_name: string;
  storage_path: string | null;
  /** Public URL for webhook-provided artwork (no Storage upload). */
  external_url?: string | null;
  mime_type: string | null;
  size: number | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface WebhookConfig {
  id: string;
  tenant_id: string;
  secret_key: string;
  enabled: boolean;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

export interface Approval {
  id: string;
  tenant_id: string;
  order_id: string;
  status: ApprovalStatus;
  token: string;
  customer_email: string | null;
  comment: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface AutomationRule {
  id: string;
  tenant_id: string;
  trigger: AutomationTrigger;
  from_column: string | null;
  to_column: string | null;
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
}

export interface JobNotification {
  id: string;
  tenant_id: string;
  order_id: string;
  type: NotificationType;
  channel: NotificationChannel;
  token: string;
  token_expires_at: string | null;
  status: NotificationStatus;
  staff_note: string | null;
  customer_response: CustomerResponse | null;
  customer_note: string | null;
  responded_at: string | null;
  created_by: string | null;
  created_at: string;
}

/** Missing-info note with staff/creator metadata for the order detail tab. */
export interface MissingInfoNote extends JobNotification {
  creator_name: string | null;
  response_assets: Asset[];
}

/** Customer-approval note with staff/creator metadata for the order detail tab. */
export interface ApprovalNote extends JobNotification {
  creator_name: string | null;
}

/**
 * The shape of an automation_rules.config object when the rule represents a
 * customer-notification trigger (action = "notify").
 */
export interface NotifyRuleConfig {
  action: "notify";
  notify_type: NotificationType;
  /** Target column when the customer rejects or requests changes (approval only). */
  rejected_to_column?: string | null;
}

export interface ActivityLog {
  id: string;
  tenant_id: string;
  order_id: string | null;
  actor: string | null;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface OrderCategorySummary {
  id: string;
  name: string;
  color: string;
}

export interface OrderWithRelations extends Order {
  customer: Customer | null;
  category?: OrderCategorySummary | null;
}

export interface Designer {
  id: string;
  name: string;
}
