"use client";

import { cn } from "@/lib/utils";

export interface TeamMember {
  id: string;
  name: string;
  role: "admin" | "designer" | "account_manager" | "pre_production_owner" | "preprod_owner" | "member";
  avatar_url?: string | null;
}

export interface PickerValue {
  mode: "all" | "roles" | "individuals";
  roles: string[];
  userIds: string[];
}

interface RoleOrIndividualPickerProps {
  value: PickerValue;
  members: TeamMember[];
  onChange: (value: PickerValue) => void;
  label?: string;
}

// Canonical role definitions shown as chips
const ROLES = [
  { key: "admin",                label: "Admin" },
  { key: "designer",             label: "Designer" },
  { key: "account_manager",      label: "Account Manager" },
  { key: "pre_production_owner", label: "Pre-Production Owner" },
] as const;

type RoleKey = (typeof ROLES)[number]["key"];

// Some members may come from the DB with "preprod_owner" (legacy) — normalise.
function normalizeRole(role: string): RoleKey | "member" {
  if (role === "preprod_owner") return "pre_production_owner";
  return role as RoleKey | "member";
}

// ── helpers ──────────────────────────────────────────────────────────────────

function getCheckedIds(value: PickerValue, members: TeamMember[]): string[] {
  const normalized = members.map((m) => ({
    ...m,
    role: normalizeRole(m.role),
  }));
  if (value.mode === "all") return normalized.map((m) => m.id);
  if (value.mode === "roles")
    return normalized.filter((m) => value.roles.includes(m.role)).map((m) => m.id);
  return value.userIds;
}

function resolveMode(checkedIds: string[], members: TeamMember[]): PickerValue {
  const normalized = members.map((m) => ({
    ...m,
    role: normalizeRole(m.role),
  }));

  if (checkedIds.length === 0 || checkedIds.length === normalized.length) {
    return { mode: "all", roles: [], userIds: [] };
  }

  // Check if checkedIds are exactly the union of one or more whole roles.
  const selectedRoles: string[] = [];
  for (const roleDef of ROLES) {
    const roleMembers = normalized
      .filter((m) => m.role === roleDef.key)
      .map((m) => m.id);
    if (roleMembers.length > 0 && roleMembers.every((id) => checkedIds.includes(id))) {
      selectedRoles.push(roleDef.key);
    }
  }

  const roleUnion = normalized
    .filter((m) => selectedRoles.includes(m.role))
    .map((m) => m.id);

  const isCleanRoleSelection =
    selectedRoles.length > 0 &&
    roleUnion.length === checkedIds.length &&
    roleUnion.every((id) => checkedIds.includes(id));

  if (isCleanRoleSelection) {
    return { mode: "roles", roles: selectedRoles, userIds: [] };
  }

  return { mode: "individuals", roles: [], userIds: checkedIds };
}

function handleRoleChipClick(
  roleKey: string,
  members: TeamMember[],
  current: PickerValue
): PickerValue {
  if (roleKey === "all") {
    return { mode: "all", roles: [], userIds: [] };
  }

  const normalized = members.map((m) => ({
    ...m,
    role: normalizeRole(m.role),
  }));
  const roleMemberIds = normalized
    .filter((m) => m.role === roleKey)
    .map((m) => m.id);

  const checkedIds = getCheckedIds(current, members);
  const allChecked =
    roleMemberIds.length > 0 && roleMemberIds.every((id) => checkedIds.includes(id));

  if (allChecked) {
    const newChecked = checkedIds.filter((id) => !roleMemberIds.includes(id));
    return resolveMode(newChecked, members);
  } else {
    const newChecked = [...new Set([...checkedIds, ...roleMemberIds])];
    return resolveMode(newChecked, members);
  }
}

function handleMemberToggle(
  memberId: string,
  current: PickerValue,
  members: TeamMember[]
): PickerValue {
  const checkedIds = getCheckedIds(current, members);
  const newChecked = checkedIds.includes(memberId)
    ? checkedIds.filter((id) => id !== memberId)
    : [...checkedIds, memberId];
  return resolveMode(newChecked, members);
}

// ── mode label ───────────────────────────────────────────────────────────────

function getModeLabel(value: PickerValue): string {
  if (value.mode === "all") return "All team members";
  if (value.mode === "roles") {
    const roleLabels = value.roles.map(
      (r) => ROLES.find((d) => d.key === r)?.label ?? r
    );
    return roleLabels.map((l) => `All ${l}s`).join(", ");
  }
  const n = value.userIds.length;
  return `${n} individual${n === 1 ? "" : "s"} selected`;
}

// ── role chip state ──────────────────────────────────────────────────────────

type ChipState = "all" | "full" | "partial" | "none";

function getRoleChipState(roleKey: string, value: PickerValue, members: TeamMember[]): ChipState {
  if (roleKey === "all") {
    return value.mode === "all" ? "all" : "none";
  }
  const normalized = members.map((m) => ({
    ...m,
    role: normalizeRole(m.role),
  }));
  const roleMemberIds = normalized
    .filter((m) => m.role === roleKey)
    .map((m) => m.id);
  if (roleMemberIds.length === 0) return "none";

  const checkedIds = getCheckedIds(value, members);
  const checkedCount = roleMemberIds.filter((id) => checkedIds.includes(id)).length;
  if (checkedCount === 0) return "none";
  if (checkedCount === roleMemberIds.length) return "full";
  return "partial";
}

// ── component ────────────────────────────────────────────────────────────────

export function RoleOrIndividualPicker({
  value,
  members,
  onChange,
  label = "Visible to",
}: RoleOrIndividualPickerProps) {
  const checkedIds = getCheckedIds(value, members);
  const modeLabel = getModeLabel(value);

  // Sort members: by role label then name
  const roleOrder: Record<string, number> = {
    admin: 0,
    designer: 1,
    account_manager: 2,
    pre_production_owner: 3,
    preprod_owner: 3,
    member: 4,
  };
  const sorted = [...members].sort((a, b) => {
    const rd = (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9);
    if (rd !== 0) return rd;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <span className="text-[11px] text-slate-400 italic">{modeLabel}</span>
      </div>

      {/* Role shortcut chips */}
      <div className="flex flex-wrap gap-1.5">
        {/* "All" chip */}
        {(() => {
          const state = getRoleChipState("all", value, members);
          return (
            <button
              key="all"
              type="button"
              onClick={() => onChange(handleRoleChipClick("all", members, value))}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-all border",
                state === "all"
                  ? "border-blue-500 bg-blue-500 text-white"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              )}
            >
              All
            </button>
          );
        })()}

        {ROLES.map((roleDef) => {
          const state = getRoleChipState(roleDef.key, value, members);
          const hasMembers = members.some(
            (m) => normalizeRole(m.role) === roleDef.key
          );
          if (!hasMembers) return null;
          return (
            <button
              key={roleDef.key}
              type="button"
              onClick={() =>
                onChange(handleRoleChipClick(roleDef.key, members, value))
              }
              className={cn(
                "relative rounded-full px-3 py-1 text-xs font-medium transition-all border",
                state === "full"
                  ? "border-blue-500 bg-blue-500 text-white"
                  : state === "partial"
                  ? "border-blue-400 bg-white text-blue-600"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              )}
            >
              {roleDef.label}
              {state === "partial" && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-blue-500 ring-1 ring-white" />
              )}
            </button>
          );
        })}
      </div>

      {/* Member list */}
      {members.length > 0 && (
        <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white divide-y divide-slate-50">
          {sorted.map((member) => {
            const isChecked = checkedIds.includes(member.id);
            const roleLabel =
              ROLES.find((r) => r.key === normalizeRole(member.role))?.label ??
              member.role;
            return (
              <label
                key={member.id}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() =>
                    onChange(handleMemberToggle(member.id, value, members))
                  }
                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-500"
                />
                <span className="flex-1 min-w-0 truncate">{member.name}</span>
                <span className="shrink-0 text-[10px] text-slate-400">
                  {roleLabel}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {members.length === 0 && (
        <p className="text-xs text-slate-400">No team members found.</p>
      )}
    </div>
  );
}
