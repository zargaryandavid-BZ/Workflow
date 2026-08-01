import Image from "next/image";
import { cn } from "@/lib/utils";

/** Label-roll icon for Application on order cards. */
export function ApplicationIcon({
  className,
  title = "Application",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <Image
      src="/icons/application.png"
      alt={title}
      width={16}
      height={16}
      className={cn("h-3.5 w-3.5 shrink-0 object-contain", className)}
      title={title}
      unoptimized
    />
  );
}
