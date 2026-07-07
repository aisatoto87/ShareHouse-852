"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import {
  groupTenantDisplayName,
  groupTenantInitials,
} from "@/lib/group-chat-members";
import type { GroupTenantMember } from "@/types/chat";

type GroupTenantAvatarGroupProps = {
  members: GroupTenantMember[];
  size?: "sm" | "md";
  /** 不傳則顯示全部成員 */
  maxVisible?: number;
  className?: string;
  /** light = 白底 header；dark = 深色 header */
  tone?: "light" | "dark";
  /** 無可顯示成員時的提示文字 */
  emptyHint?: string;
  /** 當前登入用戶；搭配 onMemberClick 時用於排除自己 */
  currentUserId?: string | null;
  /** 點擊其他室友頭像時觸發（例如開啟 P2P 私聊） */
  onMemberClick?: (member: GroupTenantMember) => void;
  /** peer = 租客私聊；admin-direct = 管家主動聯絡租客 */
  memberClickMode?: "peer" | "admin-direct";
};

const SIZE_CLASS = {
  sm: "size-7 text-[10px] ring-2",
  md: "size-9 text-[11px] ring-2",
} as const;

const OVERLAP_CLASS = {
  sm: "-ml-2",
  md: "-ml-2.5",
} as const;

function memberClickLabel(
  label: string,
  mode: "peer" | "admin-direct"
): string {
  return mode === "admin-direct" ? `聯絡 ${label}（客服）` : `與 ${label} 私聊`;
}

function MemberAvatar({
  member,
  size,
  tone,
  clickable,
  onClick,
  memberClickMode = "peer",
}: {
  member: GroupTenantMember;
  size: "sm" | "md";
  tone: "light" | "dark";
  clickable?: boolean;
  onClick?: () => void;
  memberClickMode?: "peer" | "admin-direct";
}) {
  const label = groupTenantDisplayName(member);
  const clickLabel = memberClickLabel(label, memberClickMode);
  const avatarUrl = member.avatar_url?.trim();
  const ringClass = tone === "dark" ? "ring-[#0f2540]" : "ring-white";

  const avatarContent = avatarUrl ? (
    <Image
      src={avatarUrl}
      alt={label}
      width={size === "sm" ? 28 : 36}
      height={size === "sm" ? 28 : 36}
      className={cn(
        "relative rounded-full object-cover",
        SIZE_CLASS[size],
        ringClass,
        clickable && "transition-transform hover:scale-105"
      )}
      unoptimized
    />
  ) : (
    <div
      className={cn(
        "relative flex items-center justify-center rounded-full bg-[#0f2540]/10 font-semibold text-[#0f2540]",
        SIZE_CLASS[size],
        ringClass,
        clickable && "transition-transform hover:scale-105"
      )}
      aria-hidden
    >
      {groupTenantInitials(member)}
    </div>
  );

  return (
    <div className="group/avatar relative isolate shrink-0">
      {clickable ? (
        <button
          type="button"
          onClick={onClick}
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f2540]/40"
          aria-label={clickLabel}
          title={clickLabel}
        >
          {avatarContent}
        </button>
      ) : (
        avatarContent
      )}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/avatar:opacity-100"
      >
        {clickable ? clickLabel : member.display_name?.trim() || label}
      </span>
    </div>
  );
}

export default function GroupTenantAvatarGroup({
  members,
  size = "md",
  maxVisible,
  className,
  tone = "light",
  emptyHint = "尚無成員",
  currentUserId,
  onMemberClick,
  memberClickMode = "peer",
}: GroupTenantAvatarGroupProps) {
  if (members.length === 0) {
    return (
      <span
        className={cn(
          "text-xs",
          tone === "dark" ? "text-white/50" : "text-zinc-400",
          className
        )}
      >
        {emptyHint}
      </span>
    );
  }

  const limit =
    typeof maxVisible === "number" && maxVisible > 0
      ? maxVisible
      : members.length;
  const overflow = members.length - limit;

  return (
    <div
      className={cn("max-w-full overflow-x-auto overflow-y-visible", className)}
      aria-label="群組室友"
    >
      <div className="inline-flex min-w-0 items-center overflow-visible py-0.5 pr-1">
        {members.slice(0, limit).map((member, index) => {
          const isSelf =
            typeof currentUserId === "string" && member.id === currentUserId;
          const clickable = Boolean(onMemberClick) && !isSelf;

          return (
            <div
              key={member.id}
              className={cn("relative shrink-0", index > 0 && OVERLAP_CLASS[size])}
              style={{ zIndex: index + 1 }}
            >
              <MemberAvatar
                member={member}
                size={size}
                tone={tone}
                clickable={clickable}
                memberClickMode={memberClickMode}
                onClick={
                  clickable ? () => onMemberClick?.(member) : undefined
                }
              />
            </div>
          );
        })}
        {overflow > 0 ? (
          <div
            className={cn(
              "relative flex shrink-0 items-center justify-center rounded-full bg-zinc-200 font-semibold text-zinc-600",
              SIZE_CLASS[size],
              OVERLAP_CLASS[size],
              tone === "dark" ? "ring-[#0f2540]" : "ring-white"
            )}
            style={{ zIndex: limit + 1 }}
            title={`另有 ${overflow} 位室友`}
          >
            +{overflow}
          </div>
        ) : null}
      </div>
    </div>
  );
}
