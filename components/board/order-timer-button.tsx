"use client";

import { useActiveTimer } from "@/components/time/active-timer-context";
import { CardTimerControl } from "@/components/board/card-timer-control";
import { BoardWorkerChip } from "@/components/board/board-worker-chip";
import { columnStopsWorkTimer } from "@/lib/timer-stop-columns";
import type { Role } from "@/lib/types";

/**
 * Self-contained work-timer control for a single order — Start / green live
 * elapsed / pause-with-reason / resume / stop. Used on the open card so a
 * designer can start or pause without going back to the board.
 * If someone else is already on the card, show their chip instead of Start.
 */
export function OrderTimerButton({
  orderId,
  role,
  columnKind,
  columnName,
}: {
  orderId: string | null;
  role?: Role;
  columnKind?: string | null;
  columnName?: string | null;
}) {
  const activeTimer = useActiveTimer();
  if (!orderId) return null;
  if (columnStopsWorkTimer({ kind: columnKind, name: columnName })) {
    return null;
  }
  const timer = activeTimer.forOrder(orderId);
  const boardTimer = activeTimer.boardActiveForOrder(orderId);
  const otherWorker = boardTimer && !boardTimer.isMine ? boardTimer : null;
  const canControlOthers = role === "admin";

  if (otherWorker) {
    return (
      <BoardWorkerChip
        workerName={otherWorker.workerName}
        running={otherWorker.running}
        elapsedSeconds={otherWorker.elapsedSeconds}
        canControl={canControlOthers}
        busy={activeTimer.busyOrderId === orderId}
        onPause={() => void activeTimer.pause(otherWorker.entryId)}
        onResume={() => void activeTimer.resume(otherWorker.entryId)}
        onStop={() => void activeTimer.stop(otherWorker.entryId)}
      />
    );
  }

  return (
    <CardTimerControl
      orderId={orderId}
      timer={timer}
      workedSeconds={activeTimer.workedTotalForOrder(orderId)}
      busy={activeTimer.busyOrderId === orderId}
      onStart={() => void activeTimer.start(orderId)}
      onPause={(reason) => timer && void activeTimer.pause(timer.entry.id, reason)}
      onResume={() => timer && void activeTimer.resume(timer.entry.id)}
      onStop={() => timer && void activeTimer.stop(timer.entry.id)}
    />
  );
}
