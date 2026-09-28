import type { ButtonAutomation } from "./types.ts";

/**
 * Show Print shipping slip next to Generate Packing Slip when no dedicated
 * print button exists yet.
 */
export function withPrintShippingSlipButtons(
  buttons: ButtonAutomation[]
): ButtonAutomation[] {
  if (buttons.some((b) => b.action_type === "print_packing_slip")) {
    return buttons;
  }
  const next: ButtonAutomation[] = [];
  for (const btn of buttons) {
    next.push(btn);
    if (btn.action_type === "generate_packing_slip") {
      next.push({
        ...btn,
        action_type: "print_packing_slip",
        name: "Print shipping slip",
        icon: "🖨️",
      });
    }
  }
  return next;
}

export function filterButtonsForColumn(
  buttons: ButtonAutomation[],
  columnId: string
): ButtonAutomation[] {
  return withPrintShippingSlipButtons(
    buttons.filter(
      (btn) =>
        btn.enabled &&
        (btn.column_ids.length === 0 || btn.column_ids.includes(columnId))
    )
  );
}
