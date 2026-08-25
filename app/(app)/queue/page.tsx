import { DesignerQueue } from "@/components/queue/designer-queue";

export const metadata = { title: "Designer Queue" };

export default function QueuePage() {
  return (
    <div className="board-scroll h-full overflow-y-auto">
      <DesignerQueue />
    </div>
  );
}
