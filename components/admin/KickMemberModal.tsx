"use client";

import { useEffect, useState } from "react";
import { Loader2, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { adminKickAndRebuildAction } from "@/app/admin/groups/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AdminGroupMember, AdminGroupRow } from "@/lib/admin-groups";
import { cn } from "@/lib/utils";

type KickMemberModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: AdminGroupRow | null;
  adminNotes?: string;
  onSuccess?: () => void;
};

export default function KickMemberModal({
  open,
  onOpenChange,
  group,
  adminNotes,
  onSuccess,
}: KickMemberModalProps) {
  const router = useRouter();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelectedUserId(null);
      setSubmitting(false);
    }
  }, [open]);

  async function handleConfirmKick() {
    if (!group || submitting) return;

    if (!selectedUserId) {
      toast.error("請選擇要踢出的反悔成員。");
      return;
    }

    if (group.members.length <= 1) {
      toast.error("群組僅剩一人，請改用「解散群組」。");
      return;
    }

    setSubmitting(true);
    try {
      const result = await adminKickAndRebuildAction({
        groupId: group.groupId,
        propertyId: group.propertyId,
        kickedUserId: selectedUserId,
        adminNotes,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(
        `已踢出反悔成員，群組已退回招募中（${result.remainingMemberCount} / ${result.targetSize} 人）。`
      );
      onOpenChange(false);
      onSuccess?.();
      router.refresh();
    } catch (e) {
      console.error("[KickMemberModal] kick", e);
      toast.error("處理睇樓失敗時發生錯誤。");
    } finally {
      setSubmitting(false);
    }
  }

  const members = group?.members ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>❌ 睇樓失敗 — 選擇反悔成員</DialogTitle>
          <DialogDescription>
            {group
              ? `請指出哪位成員反悔或退出。踢出後，其餘 ${Math.max(0, group.memberCount - 1)} 位室友將保留在群組內繼續招募替補。`
              : "選擇要踢出的成員。"}
          </DialogDescription>
        </DialogHeader>

        {members.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">此群組沒有成員資料。</p>
        ) : (
          <fieldset className="space-y-2 py-1" disabled={submitting}>
            <legend className="sr-only">選擇反悔成員</legend>
            {members.map((member) => (
              <MemberKickOption
                key={member.userId}
                member={member}
                selected={selectedUserId === member.userId}
                onSelect={() => setSelectedUserId(member.userId)}
              />
            ))}
          </fieldset>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={submitting || !selectedUserId || members.length <= 1}
            className="gap-1.5 bg-red-600 text-white hover:bg-red-700"
            onClick={() => void handleConfirmKick()}
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                處理中…
              </>
            ) : (
              <>
                <UserX className="size-4" aria-hidden />
                確認踢出並重建招募
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MemberKickOption({
  member,
  selected,
  onSelect,
}: {
  member: AdminGroupMember;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors",
        selected
          ? "border-red-300 bg-red-50/80 ring-1 ring-red-200"
          : "border-zinc-200 bg-white hover:border-zinc-300"
      )}
    >
      <input
        type="radio"
        name="kick-member"
        checked={selected}
        onChange={onSelect}
        className="mt-1 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-zinc-900">{member.displayName}</p>
        {member.phone ? (
          <p className="mt-0.5 font-mono text-sm text-blue-700">{member.phone}</p>
        ) : (
          <p className="mt-0.5 text-xs text-amber-700">尚未提供電話</p>
        )}
        {member.wechatId ? (
          <p className="mt-1 text-xs text-zinc-600">
            WeChat: <span className="font-mono font-medium">{member.wechatId}</span>
          </p>
        ) : null}
        <p className="mt-1 font-mono text-[10px] text-zinc-400">{member.userId}</p>
      </div>
    </label>
  );
}
