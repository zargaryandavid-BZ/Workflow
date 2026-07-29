/** Types shown in the submit form (legacy `improvement` may still exist in DB). */
export const FEEDBACK_SUBMIT_TYPES = [
  "bug",
  "feature_request",
  "question",
  "other",
] as const;

export const FEEDBACK_TYPES = [
  "improvement",
  ...FEEDBACK_SUBMIT_TYPES,
] as const;

export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export type FeedbackSubmitType = (typeof FEEDBACK_SUBMIT_TYPES)[number];

export const FEEDBACK_STATUSES = [
  "open",
  "in_review",
  "planned",
  "done",
  "declined",
] as const;

export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** Dispatched when feedback list length changes (sidebar badge). */
export const FEEDBACK_COUNT_CHANGED_EVENT = "workflow:feedback-count-changed";

export function dispatchFeedbackCountChanged(count: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(FEEDBACK_COUNT_CHANGED_EVENT, { detail: { count } })
  );
}

export const FEEDBACK_PAGES = [
  "Board",
  "Job Card",
  "Email",
  "Packing Slip (PDF)",
  "Job Ticket",
  "SMS Ready to Production",
  "Shipping Ready",
  "Missing Info",
  "Approval Request",
  "Analytics",
  "Time Tracking",
  "Navigation / Sidebar",
  "Other",
] as const;

export type FeedbackPage = (typeof FEEDBACK_PAGES)[number];

export interface FeedbackImage {
  id: string;
  file_name: string;
  mime_type: string | null;
  url: string | null;
}

export interface FeedbackItem {
  id: string;
  tenant_id: string;
  user_id: string;
  display_name: string;
  type: FeedbackType;
  page: string;
  title: string;
  comment: string;
  status: FeedbackStatus;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
  is_own: boolean;
  images: FeedbackImage[];
}

export function isFeedbackType(value: unknown): value is FeedbackType {
  return (
    typeof value === "string" &&
    (FEEDBACK_TYPES as readonly string[]).includes(value)
  );
}

export function isFeedbackSubmitType(
  value: unknown
): value is FeedbackSubmitType {
  return (
    typeof value === "string" &&
    (FEEDBACK_SUBMIT_TYPES as readonly string[]).includes(value)
  );
}

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return (
    typeof value === "string" &&
    (FEEDBACK_STATUSES as readonly string[]).includes(value)
  );
}

export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  improvement: "New Feature/Idea",
  bug: "Bug",
  feature_request: "New Feature/Idea",
  question: "Question",
  other: "Other",
};

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: "Open",
  in_review: "In Review",
  planned: "Planned",
  done: "Done",
  declined: "Declined",
};

export const FEEDBACK_TYPE_BADGE_CLASS: Record<FeedbackType, string> = {
  improvement: "bg-amber-100 text-amber-800",
  bug: "bg-red-100 text-red-800",
  feature_request: "bg-blue-100 text-blue-800",
  question: "bg-purple-100 text-purple-800",
  other: "bg-slate-100 text-slate-700",
};

export const FEEDBACK_STATUS_BADGE_CLASS: Record<FeedbackStatus, string> = {
  open: "bg-slate-100 text-slate-700",
  in_review: "bg-blue-100 text-blue-800",
  planned: "bg-amber-100 text-amber-800",
  done: "bg-green-100 text-green-800",
  declined: "bg-red-100 text-red-800",
};
