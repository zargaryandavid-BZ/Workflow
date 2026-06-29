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

export type VisibilityMode = "all" | "roles" | "individuals";

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
  /** @deprecated Use visibility_mode / visibility_roles / visibility_users_v2 */
  visible_to_roles: string[];
  /** @deprecated Use visibility_mode / visibility_roles / visibility_users_v2 */
  visible_to_users: string[];
  /** New unified visibility: 'all' | 'roles' | 'individuals'. Defaults to 'all'. */
  visibility_mode: VisibilityMode;
  visibility_roles: string[];
  visibility_users_v2: string[];
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
  removed_at: string | null;
  removed_by: string | null;
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

export interface OrderSkuImage {
  id: string;
  tenant_id: string;
  order_id: string;
  sku_id: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  storage_path: string;
  position: number;
  created_at: string;
}

export interface OrderSkuImageWithUrl extends OrderSkuImage {
  signed_url: string | null;
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

export interface WebhookHistoryEntry {
  id: string;
  tenant_id: string;
  webhook_config_id: string;
  request_payload: Record<string, unknown> | null;
  request_raw: string | null;
  response_payload: Record<string, unknown> | null;
  response_status: number;
  success: boolean;
  error_message: string | null;
  order_ids: string[];
  order_numbers: string[];
  created_at: string;
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

export type ButtonAutomationActionType =
  | "copy_link"
  | "send_email"
  | "generate_pdf";

export type ButtonAutomationEmailRecipient =
  | "customer"
  | "designer"
  | "custom";

export interface ButtonAutomationEmailConfig {
  recipient?: ButtonAutomationEmailRecipient;
  custom_email?: string;
  subject_template?: string;
}

export interface ButtonAutomation {
  id: string;
  tenant_id: string;
  name: string;
  icon: string | null;
  action_type: ButtonAutomationActionType;
  column_ids: string[];
  config: ButtonAutomationEmailConfig | Record<string, never>;
  position: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export type NotificationRuleRecipient = "customer" | "staff" | "both";

export type NotificationRuleTrigger = "on_enter_column" | "on_job_created";

export interface NotificationRule {
  id: string;
  tenant_id: string;
  name: string;
  trigger: NotificationRuleTrigger;
  column_id: string | null;
  send_email: boolean;
  send_sms: boolean;
  recipient: NotificationRuleRecipient;
  email_subject: string;
  email_body: string;
  sms_body: string;
  /** Fixed phone number to send SMS to. If empty, falls back to customer/staff phone from the order. */
  sms_to_phone: string;
  enabled: boolean;
  position: number;
  created_at: string;
  /** Who among staff receives this notification. */
  recipient_mode: VisibilityMode;
  recipient_roles: string[];
  recipient_users: string[];
}

export type FastActionButtonColor =
  | "blue"
  | "green"
  | "red"
  | "orange"
  | "yellow"
  | "purple"
  | "gray";

export interface FastActionButton {
  id: string;
  tenant_id: string;
  name: string;
  color: FastActionButtonColor;
  destination_column_id: string | null;
  show_in_columns: string[];
  /** @deprecated Use visibility_mode / visibility_roles / visibility_users */
  visible_to_roles: string[];
  notification_rule_id: string | null;
  enabled: boolean;
  position: number;
  created_at: string;
  /** New unified visibility: 'all' | 'roles' | 'individuals'. Defaults to 'all'. */
  visibility_mode: VisibilityMode;
  visibility_roles: string[];
  visibility_users: string[];
  /** Joined relation — present when queried with destination_column select. */
  destination_column?: { id: string; name: string; color: string | null } | null;
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
