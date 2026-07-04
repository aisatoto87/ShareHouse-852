"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import {
  filterGroupMembersForDisplay,
  groupTenantDisplayName,
  groupTenantInitials,
} from "@/lib/group-chat-members";
import type { GroupTenantMember } from "@/types/chat";

type GroupTenantAvatarGroupProps = {
  members: GroupTenantMember[];
  size?: "sm" | "md";
  /** 不傳則顯示全部成員 */
  maxVisible?: number;
  /** 排除當前登入用戶（租客視角顯示其他室友） */
  excludeUserId?: string | null;
  className?: string;
  /** light = 白底 header；dark = 深色 header */
  tone?: "light" | "dark";
};

const SIZE_CLASS = {
  sm: "size-7 text-[10px] ring-2",
  md: "size-9 text-[11px] ring-2",
} as const;

const OVERLAP_CLASS = {
  sm: "-ml-2",
  md: "-ml-2.5",
} as const;

function MemberAvatar({
  member,
  size,
  tone,
}: {
  member: GroupTenantMember;
  size: "sm" | "md";
  tone: "light" | "dark";
}) {
  const label = groupTenantDisplayName(member);
  const avatarUrl = member.avatar_url?.trim();
  const ringClass = tone === "dark" ? "ring-[#0f2540]" : "ring-white";

  return (
    <div className="group/avatar relative isolate shrink-0">
      {avatarUrl ? (
        <Image
          src={avatarUrl}
          alt={label}
          width={size === "sm" ? 28 : 36}
          height={size === "sm" ? 28 : 36}
          className={cn(
            "relative rounded-full object-cover",
            SIZE_CLASS[size],
            ringClass
          )}
          unoptimized
        />
      ) : (
        <div
          className={cn(
            "relative flex items-center justify-center rounded-full bg-[#0f2540]/10 font-semibold text-[#0f2540]",
            SIZE_CLASS[size],
            ringClass
          )}
          aria-hidden
        >
          {groupTenantInitials(member)}
        </div>
      )}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/avatar:opacity-100"
      >
        {member.display_name?.trim() || label}
      </span>
    </div>
  );
}

export default function GroupTenantAvatarGroup({
  members,
  size = "md",
  maxVisible,
  excludeUserId,
  className,
  tone = "light",
}: GroupTenantAvatarGroupProps) {
  const displayMembers = filterGroupMembersForDisplay(members, excludeUserId);
  if (displayMembers.length === 0) return null;

  const limit =
    typeof maxVisible === "number" && maxVisible > 0
      ? maxVisible
      : displayMembers.length;
  const visible = displayMembers.slice(0, limit);
  const overflow = displayMembers.length - visible.length;

  return (
    <div
      className={cn("max-w-full overflow-x-auto overflow-y-visible", className)}
      aria-label="群組室友"
    >
      <div className="inline-flex min-w-0 items-center overflow-visible py-0.5 pr-1">
        {visible.map((member, index) => (
          <div
            key={member.id}
            className={cn("relative shrink-0", index > 0 && OVERLAP_CLASS[size])}
            style={{ zIndex: index + 1 }}
          >
            <MemberAvatar member={member} size={size} tone={tone} />
          </div>
        ))}
        {overflow > 0 ? (
          <div
            className={cn(
              "relative flex shrink-0 items-center justify-center rounded-full bg-zinc-200 font-semibold text-zinc-600",
              SIZE_CLASS[size],
              OVERLAP_CLASS[size],
              tone === "dark" ? "ring-[#0f2540]" : "ring-white"
            )}
            style={{ zIndex: visible.length + 1 }}
            title={`另有 ${overflow} 位室友`}
          >
            +{overflow}
          </div>
        ) : null}
      </div>
    </div>
  );
}
