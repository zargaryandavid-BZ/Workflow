import { isFulfilledStage } from "./net-terms-fulfill.ts";

/**
 * Columns the approval tab ("Move to production", "Move to Returning Tickets")
 * and missing-info tab ("In progress") may move into without drop roles.
 * Finished / Fulfilled columns never qualify (they text the customer and
 * invoice net-terms orders).
 */
export function isFollowUpBypassTarget(column: {
  kind?: string | null;
  name: string;
}): boolean {
  if (isFulfilledStage(column.name)) return false;
  return (
    column.kind === "done" ||
    column.kind === "exception" ||
    column.name.toLowerCase().includes("in progress")
  );
}
