"use client";

import { useActiveTimer } from "@/components/time/active-timer-context";
import { CardTimerControl } from "@/components/board/card-timer-control";

/**
 * Self-contained work-timer control for a single order — Start / green live
 * elapsed / pause-with-reason / resume / stop. Used on the open card so a
 * designer can start or pause without going back to the board.
 */
export function OrderTimerButton({ orderId }: { orderId: string | null }) {
  const activeTimer = useActiveTimer();
  if (!orderId) return null;
  const timer = activeTimer.forOrder(orderId);
  return (
    <CardTimerControl
      orderId={orderId}
      timer={timer}
      busy={activeTimer.busyOrderId === orderId}
      onStart={() => void activeTimer.start(orderId)}
      onPause={(reason) => timer && void activeTimer.pause(timer.entry.id, reason)}
      onResume={() => timer && void activeTimer.resume(timer.entry.id)}
      onStop={() => timer && void activeTimer.stop(timer.entry.id)}
    />
  );
}
