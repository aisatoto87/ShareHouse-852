"use client";

import { Loader2 } from "lucide-react";
import GroupTenantAvatarGroup from "@/components/chat/GroupTenantAvatarGroup";
import { useGroupTenantMembers } from "@/hooks/useGroupTenantMembers";
import { cn } from "@/lib/utils";

type GroupChatMemberBarProps = {
  matchGroupId: string | null | undefined;
  tone?: "light" | "dark";
  size?: "sm" | "md";
  className?: string;
  label?: string;
  excludeUserId?: string | null;
  maxVisible?: number;
};

export default function GroupChatMemberBar({
  matchGroupId,
  tone = "light",
  size = "md",
  className,
  label = "群組室友",
  excludeUserId,
  maxVisible,
}: GroupChatMemberBarProps) {
  const { members, loading } = useGroupTenantMembers(matchGroupId);

  if (loading) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Loader2
          className={cn(
            "animate-spin",
            tone === "dark" ? "size-3.5 text-white/60" : "size-3.5 text-zinc-400"
          )}
          aria-hidden
        />
        <span
          className={cn(
            "text-[11px]",
            tone === "dark" ? "text-white/60" : "text-zinc-400"
          )}
        >
          載入室友…
        </span>
      </div>
    );
  }

  const visibleCount = excludeUserId
    ? members.filter((member) => member.id !== excludeUserId).length
    : members.length;

  if (visibleCount === 0) return null;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 overflow-visible", className)}>
      <p
        className={cn(
          "text-[10px] font-medium uppercase tracking-wide",
          tone === "dark" ? "text-white/60" : "text-zinc-500"
        )}
      >
        {label}
      </p>
      <GroupTenantAvatarGroup
        members={members}
        size={size}
        tone={tone}
        excludeUserId={excludeUserId}
        maxVisible={maxVisible}
      />
    </div>
  );
}
