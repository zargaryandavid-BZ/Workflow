import { PrePressQueue } from "@/components/queue/prepress-queue";

export const metadata = { title: "Pre-press Queue" };

export default function PrePressQueuePage() {
  return (
    <div className="board-scroll h-full overflow-y-auto">
      <PrePressQueue />
    </div>
  );
}
