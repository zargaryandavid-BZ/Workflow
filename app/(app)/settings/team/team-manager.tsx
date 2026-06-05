"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Send, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { initials, formatDate } from "@/lib/utils";
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "@/lib/constants";
import type { TeamMemberRow } from "@/lib/team-members";
import type { Role } from "@/lib/types";

export type MemberRow = TeamMemberRow;

export function TeamManager({
  initialMembers,
  loadError: initialLoadError,
  currentUserId,
}: {
  initialMembers: MemberRow[];
  loadError: string | null;
  currentUserId: string;
}) {
  const router = useRouter();
  const [members, setMembers] = useState<MemberRow[]>(initialMembers);
  const [loadError, setLoadError] = useState<string | null>(initialLoadError);
  const [refreshing, setRefreshing] = useState(false);

  const refreshMembers = useCallback(async () => {
    setRefreshing(true);
    const res = await fetch("/api/members");
    const json = await res.json();
    setRefreshing(false);
    if (!res.ok) {
      setLoadError(json.error ?? "Could not load team.");
      return;
    }
    setLoadError(null);
    setMembers(json.members ?? []);
  }, []);

  useEffect(() => {
    setMembers(initialMembers);
    setLoadError(initialLoadError);
  }, [initialMembers, initialLoadError]);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("designer");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const activeMembers = members.filter((m) => !m.pending);
  const pendingMembers = members.filter((m) => m.pending);

  async function afterMembershipChange() {
    await refreshMembers();
    router.refresh();
  }

  interface InviteResponse {
    emailSent?: boolean;
    existed?: boolean;
    alreadyActive?: boolean;
    emailError?: string;
    inviteUrl?: string;
  }

  function applyInviteResult(json: InviteResponse, who: string, resend = false) {
    if (json.alreadyActive) {
      setMessage(`${who} already has an account and was added to the team.`);
      setInviteUrl(null);
      return;
    }

    if (json.emailSent) {
      setMessage(
        resend
          ? `Invite email sent to ${who}.`
          : `Invite email sent to ${who}.`
      );
      setInviteUrl(null);
      setError(null);
      return;
    }

    setMessage(
      `${who} was added to the team. Email could not be sent — copy the signup link below.`
    );
    setInviteUrl(json.inviteUrl ?? null);
    setError(
      json.emailError ??
        (json.inviteUrl
          ? null
          : "No signup link was generated. Check Instantly configuration and redirect URLs.")
    );
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setInviteUrl(null);
    setCopied(false);
    setLoading(true);
    const res = await fetch("/api/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName, email, role }),
    });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(json.error ?? "Failed to invite");
      return;
    }
    applyInviteResult(json, fullName ? `${fullName} (${email})` : email);
    setFullName("");
    setEmail("");
    await afterMembershipChange();
  }

  async function resend(member: MemberRow) {
    if (!member.email) return;
    setError(null);
    setMessage(null);
    setInviteUrl(null);
    setCopied(false);
    setResendingId(member.user_id);
    const res = await fetch("/api/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: member.email,
        role: member.role,
        fullName: member.profile?.full_name ?? undefined,
      }),
    });
    const json = await res.json();
    setResendingId(null);
    if (!res.ok) {
      setError(json.error ?? "Failed to resend invite");
      return;
    }
    applyInviteResult(json, member.email, true);
    await afterMembershipChange();
  }

  async function copyInvite() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function changeRole(userId: string, newRole: Role) {
    const res = await fetch(`/api/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    if (!res.ok) {
      const json = await res.json();
      setError(json.error ?? "Failed");
      return;
    }
    await afterMembershipChange();
  }

  async function remove(userId: string) {
    const res = await fetch(`/api/members/${userId}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json();
      setError(json.error ?? "Failed");
      return;
    }
    await afterMembershipChange();
  }

  return (
    <div className="space-y-6">
      {loadError ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          Could not load team: {loadError}
        </p>
      ) : null}
      <form
        onSubmit={invite}
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="t-name">Full name</Label>
            <Input
              id="t-name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Alex Printer"
            />
          </div>
          <div>
            <Label htmlFor="t-email">Email</Label>
            <Input
              id="t-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@printhouse.com"
            />
          </div>
          <div>
            <Label htmlFor="t-role">Position</Label>
            <Select
              id="t-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {message}
          </p>
        ) : null}
        {inviteUrl ? (
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <Label>Invite link</Label>
            <div className="flex items-center gap-2">
              <Input readOnly value={inviteUrl} className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={copyInvite}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              Email could not be sent. Copy this link and send it to your
              teammate manually.
            </p>
          </div>
        ) : null}
        <Button type="submit" disabled={loading}>
          <UserPlus className="h-4 w-4" />
          {loading ? "Inviting…" : "Send invite"}
        </Button>
      </form>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">
            Current team members
          </h2>
          <button
            type="button"
            onClick={() => refreshMembers()}
            disabled={refreshing}
            className="text-xs font-medium text-[var(--primary)] hover:underline disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white">
          {members.length === 0 && !loadError ? (
            <p className="p-4 text-sm text-slate-400">
              No members in this workspace yet. Send an invite above — each
              person is stored in Supabase{" "}
              <code className="text-xs">memberships</code> and Auth.
            </p>
          ) : activeMembers.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">
              No one has finished signup yet. Pending invites are listed below.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {activeMembers.map((m) => (
                <li
                  key={m.user_id}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
                      {initials(m.profile?.full_name)}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        {m.profile?.full_name ?? m.email ?? "Member"}
                        {m.user_id === currentUserId ? (
                          <span className="ml-2 text-xs text-slate-400">
                            (you)
                          </span>
                        ) : null}
                      </p>
                      {m.email ? (
                        <p className="text-xs text-slate-400">{m.email}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      className="h-8 w-44 text-xs"
                      value={m.role}
                      onChange={(e) =>
                        changeRole(m.user_id, e.target.value as Role)
                      }
                    >
                      {!ASSIGNABLE_ROLES.includes(m.role) ? (
                        <option value={m.role}>
                          {ROLE_LABELS[m.role] ?? m.role} (legacy)
                        </option>
                      ) : null}
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </Select>
                    {m.user_id !== currentUserId ? (
                      <button
                        onClick={() => remove(m.user_id)}
                        className="rounded p-1.5 text-slate-400 hover:bg-red-100 hover:text-red-600"
                        aria-label="Remove member"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {pendingMembers.length > 0 ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            Pending invites
          </h2>
          <div className="rounded-lg border border-slate-200 bg-white">
            <ul className="divide-y divide-slate-100">
              {pendingMembers.map((m) => (
                <li
                  key={m.user_id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                      <Mail className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {m.email ?? m.profile?.full_name ?? "Invited user"}
                      </p>
                      <p className="text-xs text-slate-400">
                        {ROLE_LABELS[m.role] ?? m.role} · invited{" "}
                        {formatDate(m.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge className="bg-amber-100 text-amber-700">
                      Pending
                    </Badge>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={resendingId === m.user_id}
                      onClick={() => resend(m)}
                    >
                      <Send className="h-3.5 w-3.5" />
                      {resendingId === m.user_id ? "Sending…" : "Resend"}
                    </Button>
                    <button
                      onClick={() => remove(m.user_id)}
                      className="rounded p-1.5 text-slate-400 hover:bg-red-100 hover:text-red-600"
                      aria-label="Revoke invite"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
