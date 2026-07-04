"use client";

import { useMounted } from "@/hooks/useMounted";
import { cn } from "@/lib/utils";

type ClientOnlyFormattedTimeProps = {
  value: string;
  format: (value: string) => string;
  className?: string;
};

/** 僅在 client mount 後格式化時間，避免 hydration mismatch */
export default function ClientOnlyFormattedTime({
  value,
  format,
  className,
}: ClientOnlyFormattedTimeProps) {
  const mounted = useMounted();

  return (
    <span className={cn(className)} suppressHydrationWarning>
      {mounted ? format(value) : ""}
    </span>
  );
}
