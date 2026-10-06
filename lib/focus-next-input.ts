import type { KeyboardEvent } from "react";

/** Move Enter-key focus through inputs inside one marked sequence container. */
export function focusNextInputOnEnter(
  event: KeyboardEvent<HTMLInputElement>
): void {
  if (event.key !== "Enter") return;

  event.preventDefault();
  const container = event.currentTarget.closest(
    "[data-enter-focus-sequence]"
  );
  if (!container) return;

  const inputs = Array.from(
    container.querySelectorAll<HTMLInputElement>(
      "input[data-enter-focus-next]:not(:disabled)"
    )
  );
  const currentIndex = inputs.indexOf(event.currentTarget);
  const next = inputs[currentIndex + 1];
  if (!next) return;

  next.focus();
  next.select();
}
