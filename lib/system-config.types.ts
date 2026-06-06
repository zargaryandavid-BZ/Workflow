import type {
  AutomationTrigger,
  ColumnKind,
  CustomFieldType,
  Role,
} from "@/lib/types";

export interface SystemConfig {
  version: "1.0";
  exported_at: string;
  tenant_name: string;
  columns: ColumnConfig[];
  custom_fields: CustomFieldConfig[];
  automations: AutomationConfig[];
  integrations: IntegrationConfig[];
  team: TeamMemberConfig[];
}

export interface ColumnConfig {
  name: string;
  position: number;
  color: string | null;
  kind: ColumnKind;
  image_url: string | null;
  drop_in_roles: Role[] | null;
  drop_out_roles: Role[] | null;
}

export interface CustomFieldConfig {
  name: string;
  field_type: CustomFieldType;
  options: string[];
  required: boolean;
  position: number;
}

export interface AutomationConfig {
  trigger: AutomationTrigger;
  /** Column name (not UUID) for portability across tenants. */
  from_column: string | null;
  to_column: string | null;
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface IntegrationConfig {
  name: string;
  provider: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface TeamMemberConfig {
  email: string;
  full_name: string | null;
  role: Role;
}
