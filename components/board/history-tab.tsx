"use client";

import { Mail, MessageSquare } from "lucide-react";
import {
  sentMessagesFromActivity,
  type ActivityLogEntry,
} from "@/lib/activity";
import { cn, formatDateTime } from "@/lib/utils";

interface HistoryTabProps {
  activity: ActivityLogEntry[];
}

function channelLabel(channel: string) {
  if (channel === "both") return "Email + SMS";
  if (channel === "sms") return "SMS";
  if (channel === "email") return "Email";
  return "Message";
}

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === "sms") {
    return <MessageSquare className="h-3.5 w-3.5 shrink-0" />;
  }
  return <Mail className="h-3.5 w-3.5 shrink-0" />;
}

export function HistoryTab({ activity }: HistoryTabProps) {
  const messages = sentMessagesFromActivity(activity);

  if (messages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
        No messages sent yet. Email and SMS from this card will appear here.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {messages.map((msg) => (
        <article
          key={msg.id}
          className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    msg.channel === "sms"
                      ? "bg-sky-50 text-sky-700"
                      : msg.channel === "email"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                  )}
                >
                  <ChannelIcon channel={msg.channel} />
                  {channelLabel(msg.channel)}
                </span>
                <h3 className="text-sm font-semibold text-slate-800">
                  {msg.title}
                </h3>
              </div>
              {msg.to ? (
                <p className="mt-1 text-xs text-slate-500">To: {msg.to}</p>
              ) : null}
            </div>
            <div className="text-right text-xs text-slate-400">
              <div>{formatDateTime(msg.created_at)}</div>
              {msg.actor_name ? (
                <div className="mt-0.5">by {msg.actor_name}</div>
              ) : null}
            </div>
          </div>

          {msg.subject ? (
            <p className="mt-3 text-xs font-medium text-slate-600">
              Subject: {msg.subject}
            </p>
          ) : null}

          {msg.messageBody ? (
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
              {msg.messageBody}
            </pre>
          ) : (
            <p className="mt-2 text-xs italic text-slate-400">
              Message content was not recorded for this send.
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
