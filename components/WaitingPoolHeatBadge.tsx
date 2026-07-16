import { cn } from "@/lib/utils";
import {
  resolveWaitingPoolHeatLevel,
  waitingPoolHeatClassName,
  waitingPoolHeatLabel,
} from "@/lib/waiting-pool";

type WaitingPoolHeatBadgeProps = {
  waitingCount: number;
  targetSize: number;
  className?: string;
  /** 較大尺寸（詳情頁側欄） */
  size?: "sm" | "md";
};

export default function WaitingPoolHeatBadge({
  waitingCount,
  targetSize,
  className,
  size = "sm",
}: WaitingPoolHeatBadgeProps) {
  const level = resolveWaitingPoolHeatLevel(waitingCount, targetSize);
  const label = waitingPoolHeatLabel(waitingCount, targetSize);

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-lg border font-medium leading-snug",
        waitingPoolHeatClassName(level),
        size === "md" ? "px-3 py-2 text-sm" : "px-2.5 py-1 text-[11px]",
        className
      )}
      role="status"
      aria-label={label}
    >
      {label}
    </span>
  );
}
