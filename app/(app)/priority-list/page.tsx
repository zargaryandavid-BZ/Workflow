import { PriorityListBoard } from "@/components/priority-list/priority-list-board";

export const metadata = { title: "Priority List" };

export default function PriorityListPage() {
  return (
    <div className="board-scroll h-full overflow-y-auto">
      <PriorityListBoard />
    </div>
  );
}
