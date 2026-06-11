"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardCopy, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  adminAddToGroupAction,
  adminDissolveGroupAction,
  adminKickGroupMemberAction,
} from "@/app/admin/groups/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AdminGroupMember, AdminGroupRow } from "@/lib/admin-groups";
import { cn } from "@/lib/utils";

const STATUS_BADGE: Record<string, string> = {
  recruiting: "border-emerald-200 bg-emerald-50 text-emerald-800",
  pending_opt_in: "border-amber-200 bg-amber-50 text-amber-800",
  confirmed: "border-blue-200 bg-blue-50 text-blue-800",
  matched: "border-violet-200 bg-violet-50 text-violet-800",
};

const ACTIVE_STATUSES = new Set(["recruiting", "pending_opt_in"]);
const CONFIRMED_STATUSES = new Set(["confirmed", "matched"]);

type AdminGroupsClientProps = {
  groups: AdminGroupRow[];
  fetchError: string | null;
};

function PropertyCell({ group }: { group: AdminGroupRow }) {
  return (
    <td className="px-4 py-4">
      <p className="font-medium text-zinc-900">{group.propertyTitle}</p>
      {group.propertyId ? (
        <Link
          href={`/property/${group.propertyId}`}
          target="_blank"
          className="mt-1 inline-block text-xs text-blue-600 hover:underline"
        >
          查看樓盤 ↗
        </Link>
      ) : null}
      <p className="mt-1 font-mono text-[10px] text-zinc-400">{group.groupId.slice(0, 8)}…</p>
    </td>
  );
}

function StatusBadge({ group }: { group: AdminGroupRow }) {
  return (
    <Badge
      className={cn(
        "rounded-full font-medium",
        STATUS_BADGE[group.status] ?? "bg-zinc-100 text-zinc-700"
      )}
    >
      {group.statusLabel}
    </Badge>
  );
}

async function copyMemberPhones(members: AdminGroupMember[]) {
  const phones = members.map((m) => m.phone).filter((p): p is string => Boolean(p));
  if (phones.length === 0) {
    toast.error("此群組成員尚未提供電話號碼");
    return;
  }
  try {
    await navigator.clipboard.writeText(phones.join("\n"));
    toast.success(`已複製 ${phones.length} 個電話號碼`);
  } catch (err) {
    console.error("[AdminGroupsClient] copy phones", err);
    toast.error("複製失敗，請手動選取號碼");
  }
}

export default function AdminGroupsClient({ groups, fetchError }: AdminGroupsClientProps) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<AdminGroupRow | null>(null);
  const [userIdInput, setUserIdInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dissolvingGroupId, setDissolvingGroupId] = useState<string | null>(null);
  const [copyingGroupId, setCopyingGroupId] = useState<string | null>(null);
  const [kickingMemberKey, setKickingMemberKey] = useState<string | null>(null);

  const activeGroups = useMemo(
    () => groups.filter((g) => ACTIVE_STATUSES.has(g.status)),
    [groups]
  );
  const confirmedGroups = useMemo(
    () => groups.filter((g) => CONFIRMED_STATUSES.has(g.status)),
    [groups]
  );

  function openAddDialog(group: AdminGroupRow) {
    setActiveGroup(group);
    setUserIdInput("");
    setDialogOpen(true);
  }

  async function handleSubmit() {
    if (!activeGroup || submitting) return;

    setSubmitting(true);
    try {
      const result = await adminAddToGroupAction(activeGroup.groupId, userIdInput);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("已成功將用戶加入群組");
      setDialogOpen(false);
      router.refresh();
    } catch (err) {
      console.error("[AdminGroupsClient] add member", err);
      toast.error(err instanceof Error ? err.message : "加入群組時發生未知錯誤");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDissolve(group: AdminGroupRow) {
    if (dissolvingGroupId || submitting) return;

    const confirmed = window.confirm(
      "確定要解散此群組並將所有成員退回『排隊中』狀態嗎？"
    );
    if (!confirmed) return;

    setDissolvingGroupId(group.groupId);
    try {
      const result = await adminDissolveGroupAction(group.groupId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("群組已解散，成員已退回排隊中狀態");
      router.refresh();
    } catch (err) {
      console.error("[AdminGroupsClient] dissolve group", err);
      toast.error(err instanceof Error ? err.message : "解散群組時發生未知錯誤");
    } finally {
      setDissolvingGroupId(null);
    }
  }

  async function handleCopyPhones(group: AdminGroupRow) {
    if (copyingGroupId) return;
    setCopyingGroupId(group.groupId);
    try {
      await copyMemberPhones(group.members);
    } finally {
      setCopyingGroupId(null);
    }
  }

  async function handleKickMember(group: AdminGroupRow, member: AdminGroupMember) {
    if (kickingMemberKey || dissolvingGroupId) return;

    const confirmed = window.confirm(
      `確定要將「${member.displayName}」踢出群組嗎？群組將降級為招募中，樓盤預留亦會解除。`
    );
    if (!confirmed) return;

    const memberKey = `${group.groupId}:${member.userId}`;
    setKickingMemberKey(memberKey);
    try {
      const result = await adminKickGroupMemberAction(group.groupId, member.userId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("已踢除成員，群組已退回招募中");
      router.refresh();
    } catch (err) {
      console.error("[AdminGroupsClient] kick member", err);
      toast.error(err instanceof Error ? err.message : "踢除成員時發生未知錯誤");
    } finally {
      setKickingMemberKey(null);
    }
  }

  async function handleDissolveConfirmed(group: AdminGroupRow) {
    if (dissolvingGroupId || kickingMemberKey) return;

    const confirmed = window.confirm(
      "確定要解散此已成團群組嗎？所有成員將退回排隊中，樓盤預留亦會解除。"
    );
    if (!confirmed) return;

    setDissolvingGroupId(group.groupId);
    try {
      const result = await adminDissolveGroupAction(group.groupId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("群組已解散，成員已退回排隊中狀態");
      router.refresh();
    } catch (err) {
      console.error("[AdminGroupsClient] dissolve confirmed group", err);
      toast.error(err instanceof Error ? err.message : "解散群組時發生未知錯誤");
    } finally {
      setDissolvingGroupId(null);
    }
  }

  if (fetchError) {
    return (
      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="p-6 text-sm text-red-600">讀取群組失敗：{fetchError}</div>
      </section>
    );
  }

  return (
    <>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[#0f2540]">進行中的配對群組</h2>
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          {activeGroups.length === 0 ? (
            <div className="p-10 text-center text-sm text-zinc-500">
              目前沒有招募中或待確認的配對群組。
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-200 text-sm">
                <thead className="bg-zinc-50/80 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-3">樓盤</th>
                    <th className="px-4 py-3">群組狀態</th>
                    <th className="px-4 py-3">人數</th>
                    <th className="px-4 py-3">成員</th>
                    <th className="px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {activeGroups.map((group) => (
                    <tr key={group.groupId} className="align-top">
                      <PropertyCell group={group} />
                      <td className="px-4 py-4">
                        <StatusBadge group={group} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-zinc-800">
                        <span className="font-semibold text-[#0f2540]">{group.memberCount}</span>
                        <span className="text-zinc-400"> / {group.targetSize}</span>
                        {group.shortage > 0 ? (
                          <p className="mt-1 text-xs text-amber-700">尚欠 {group.shortage} 人</p>
                        ) : (
                          <p className="mt-1 text-xs text-emerald-700">已滿</p>
                        )}
                      </td>
                      <td className="px-4 py-4 text-zinc-700">
                        {group.members.length === 0 ? (
                          <span className="text-zinc-400">—</span>
                        ) : (
                          <ul className="space-y-1">
                            {group.members.map((m) => (
                              <li key={m.userId}>
                                <span className="font-medium">{m.displayName}</span>
                                <span className="ml-1 font-mono text-[10px] text-zinc-400">
                                  ({m.userId.slice(0, 8)}…)
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="flex flex-col items-end gap-2">
                          {group.shortage > 0 ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              disabled={dissolvingGroupId === group.groupId || submitting}
                              onClick={() => openAddDialog(group)}
                            >
                              <UserPlus className="h-4 w-4" />
                              手動加人
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={dissolvingGroupId != null || submitting}
                            className={cn(
                              "gap-1.5 border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700",
                              dissolvingGroupId === group.groupId && "opacity-80"
                            )}
                            onClick={() => void handleDissolve(group)}
                          >
                            {dissolvingGroupId === group.groupId ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                解散中…
                              </>
                            ) : (
                              <>💥 解散群組</>
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-[#0f2540]">
            🎉 已成團群組 — 待管家跟進
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            全員已同意且滿員的群組。請複製聯絡方式並手動建立 WhatsApp 群組。
          </p>
        </div>
        <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
          {confirmedGroups.length === 0 ? (
            <div className="p-10 text-center text-sm text-zinc-500">目前沒有已成團待跟進的群組。</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-200 text-sm">
                <thead className="bg-emerald-50/60 text-left text-xs font-semibold uppercase tracking-wide text-emerald-900/70">
                  <tr>
                    <th className="px-4 py-3">樓盤</th>
                    <th className="px-4 py-3">群組狀態</th>
                    <th className="px-4 py-3">人數</th>
                    <th className="px-4 py-3">成員聯絡方式</th>
                    <th className="px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {confirmedGroups.map((group) => (
                    <tr key={group.groupId} className="align-top">
                      <PropertyCell group={group} />
                      <td className="px-4 py-4">
                        <StatusBadge group={group} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-zinc-800">
                        <span className="font-semibold text-[#0f2540]">{group.memberCount}</span>
                        <span className="text-zinc-400"> / {group.targetSize}</span>
                        <p className="mt-1 text-xs text-emerald-700">已滿員</p>
                      </td>
                      <td className="px-4 py-4 text-zinc-800">
                        {group.members.length === 0 ? (
                          <span className="text-zinc-400">—</span>
                        ) : (
                          <ul className="space-y-2">
                            {group.members.map((m) => {
                              const memberKey = `${group.groupId}:${m.userId}`;
                              const isKicking = kickingMemberKey === memberKey;
                              return (
                                <li
                                  key={m.userId}
                                  className="rounded-lg border border-zinc-100 bg-zinc-50/80 px-3 py-2"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <p className="font-semibold text-zinc-900">{m.displayName}</p>
                                      {m.phone ? (
                                        <a
                                          href={`tel:${m.phone.replace(/\s/g, "")}`}
                                          className="mt-0.5 inline-block font-mono text-sm text-blue-700 hover:underline"
                                        >
                                          {m.phone}
                                        </a>
                                      ) : (
                                        <p className="mt-0.5 text-xs text-amber-700">尚未提供電話</p>
                                      )}
                                      {m.wechatId ? (
                                        <p className="mt-1 text-xs text-zinc-600">
                                          WeChat:{" "}
                                          <span className="font-mono font-medium text-zinc-800">
                                            {m.wechatId}
                                          </span>
                                        </p>
                                      ) : (
                                        <p className="mt-1 text-xs text-zinc-400">尚未提供微信 ID</p>
                                      )}
                                    </div>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      disabled={isKicking || dissolvingGroupId != null}
                                      className="shrink-0 gap-1 border-red-200 bg-red-50 px-2 text-xs text-red-700 hover:bg-red-100"
                                      onClick={() => void handleKickMember(group, m)}
                                    >
                                      {isKicking ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        "踢除"
                                      )}
                                    </Button>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="flex flex-col items-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-1.5 border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                            disabled={copyingGroupId === group.groupId || kickingMemberKey != null}
                            onClick={() => void handleCopyPhones(group)}
                          >
                            {copyingGroupId === group.groupId ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                複製中…
                              </>
                            ) : (
                              <>
                                <ClipboardCopy className="h-4 w-4" />
                                📋 複製全員號碼
                              </>
                            )}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={dissolvingGroupId != null || kickingMemberKey != null}
                            className={cn(
                              "gap-1.5 border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700",
                              dissolvingGroupId === group.groupId && "opacity-80"
                            )}
                            onClick={() => void handleDissolveConfirmed(group)}
                          >
                            {dissolvingGroupId === group.groupId ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                解散中…
                              </>
                            ) : (
                              <>💥 解散群組</>
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>➕ 手動加人至群組</DialogTitle>
            <DialogDescription>
              {activeGroup
                ? `樓盤：${activeGroup.propertyTitle}（尚欠 ${activeGroup.shortage} 人）`
                : "輸入要加入的 Supabase user UUID。"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="admin-add-user-id">User ID (UUID)</Label>
            <Input
              id="admin-add-user-id"
              value={userIdInput}
              onChange={(e) => setUserIdInput(e.target.value)}
              placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
              className="font-mono text-xs"
              disabled={submitting}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={submitting}
            >
              取消
            </Button>
            <Button type="button" onClick={() => void handleSubmit()} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  處理中…
                </>
              ) : (
                "確認加入"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
