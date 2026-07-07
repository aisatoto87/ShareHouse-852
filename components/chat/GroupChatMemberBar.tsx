"use client";

import { Loader2 } from "lucide-react";
import GroupTenantAvatarGroup from "@/components/chat/GroupTenantAvatarGroup";
import { useGroupTenantMembers } from "@/hooks/useGroupTenantMembers";
import { cn } from "@/lib/utils";
import type { GroupTenantMember } from "@/types/chat";

type GroupChatMemberBarProps = {
  matchGroupId: string | null | undefined;
  tone?: "light" | "dark";
  size?: "sm" | "md";
  className?: string;
  label?: string;
  maxVisible?: number;
  currentUserId?: string | null;
  onMemberClick?: (member: GroupTenantMember) => void;
  memberClickMode?: "peer" | "admin-direct";
};

function emptyHintClass(tone: "light" | "dark"): string {
  return tone === "dark" ? "text-xs text-white/50" : "text-xs text-zinc-400";
}

export default function GroupChatMemberBar({
  matchGroupId,
  tone = "light",
  size = "md",
  className,
  label = "群組室友",
  maxVisible,
  currentUserId,
  onMemberClick,
  memberClickMode = "peer",
}: GroupChatMemberBarProps) {
  const resolvedGroupId =
    typeof matchGroupId === "string" && matchGroupId.trim() !== ""
      ? matchGroupId.trim()
      : null;

  const { members, loading } = useGroupTenantMembers(resolvedGroupId);

  if (!resolvedGroupId) {
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <p className={emptyHintClass(tone)}>缺少群組 ID，無法載入室友</p>
      </div>
    );
  }

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
        maxVisible={maxVisible}
        emptyHint="尚無成員"
        currentUserId={currentUserId}
        onMemberClick={onMemberClick}
        memberClickMode={memberClickMode}
      />
    </div>
  );
}
