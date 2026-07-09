"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UnreadCountBadge } from "@/components/chat/UnreadCountBadge";
import { useAdminPendingCounts } from "@/hooks/useAdminPendingCounts";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/admin", label: "總指揮部", match: (path: string) => path === "/admin" },
  {
    href: "/admin/inbox",
    label: "客服與通訊收件箱",
    match: (path: string) => path.startsWith("/admin/inbox"),
    badge: "inbox" as const,
  },
  {
    href: "/admin/moderation",
    label: "投訴與審查中心",
    match: (path: string) => path.startsWith("/admin/moderation"),
    badge: "moderation" as const,
  },
  {
    href: "/admin/groups",
    label: "配對群組",
    match: (path: string) => path.startsWith("/admin/groups"),
  },
] as const;

export default function AdminSubNav() {
  const pathname = usePathname() ?? "";
  const { inbox_unread_count, moderation_total_count } = useAdminPendingCounts();

  return (
    <nav
      aria-label="管家後台導覽"
      className="rounded-xl border border-[#0f2540]/10 bg-white p-1.5 shadow-sm"
    >
      <ul className="flex flex-wrap gap-1">
        {NAV_ITEMS.map((item) => {
          const active = item.match(pathname);
          const badgeCount =
            "badge" in item && item.badge === "inbox"
              ? inbox_unread_count
              : "badge" in item && item.badge === "moderation"
                ? moderation_total_count
                : 0;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-[#0f2540] text-white shadow-sm"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                )}
              >
                {item.label}
                <UnreadCountBadge
                  count={badgeCount}
                  className={cn(
                    "ml-1.5",
                    active ? "ring-[#0f2540]" : "ring-white"
                  )}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
