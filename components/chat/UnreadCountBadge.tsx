import { cn } from "@/lib/utils";

type UnreadCountBadgeProps = {
  count: number;
  className?: string;
  /** 僅顯示紅點、不顯示數字 */
  dotOnly?: boolean;
};

export function formatUnreadCount(count: number): string {
  if (count > 99) return "99+";
  return String(count);
}

export function UnreadCountBadge({
  count,
  className,
  dotOnly = false,
}: UnreadCountBadgeProps) {
  if (count <= 0) return null;

  if (dotOnly) {
    return (
      <span
        className={cn(
          "size-2 shrink-0 rounded-full bg-red-500 ring-2 ring-white",
          className
        )}
        aria-label={`${count} 則未讀訊息`}
      />
    );
  }

  const label = formatUnreadCount(count);
  const wide = count > 9;

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-red-500 font-bold text-white shadow-sm",
        wide ? "h-5 min-w-5 px-1 text-[10px]" : "h-4 w-4 text-[10px]",
        className
      )}
      aria-label={`${count} 則未讀訊息`}
    >
      {label}
    </span>
  );
}
