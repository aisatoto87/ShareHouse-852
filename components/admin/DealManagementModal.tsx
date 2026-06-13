"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, ClipboardList, Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  adminGetOfflineDealAction,
  adminUpdateOfflineDealAction,
} from "@/app/admin/groups/actions";
import KickMemberModal from "@/components/admin/KickMemberModal";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { AdminGroupRow } from "@/lib/admin-groups";
import {
  ADMIN_OFFLINE_DEAL_STATUSES,
  ADMIN_OFFLINE_DEAL_STATUS_LABELS,
  type AdminOfflineDealStatus,
} from "@/types/offline-deal";

type DealManagementModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: AdminGroupRow | null;
};

function toDatetimeLocalFromIso(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoFromDatetimeLocal(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export default function DealManagementModal({
  open,
  onOpenChange,
  group,
}: DealManagementModalProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<AdminOfflineDealStatus>("pending_schedule");
  const [viewingTimeLocal, setViewingTimeLocal] = useState("");
  const [viewingNotes, setViewingNotes] = useState("");
  const [kickModalOpen, setKickModalOpen] = useState(false);

  const loadDeal = useCallback(async () => {
    if (!group?.groupId) return;

    setLoading(true);
    setLoadError(null);
    try {
      const result = await adminGetOfflineDealAction(group.groupId);
      if (!result.ok) {
        setLoadError(result.error);
        return;
      }

      setStatus(result.deal.status);
      setViewingTimeLocal(toDatetimeLocalFromIso(result.deal.viewing_time));
      setViewingNotes(result.deal.viewing_notes ?? "");
    } catch (e) {
      console.error("[DealManagementModal] load", e);
      setLoadError("讀取線下追蹤資料時發生錯誤。");
    } finally {
      setLoading(false);
    }
  }, [group?.groupId]);

  useEffect(() => {
    if (!open || !group) return;
    void loadDeal();
  }, [open, group, loadDeal]);

  async function handleSave() {
    if (!group || saving) return;

    if (status === "viewing_failed") {
      setKickModalOpen(true);
      return;
    }

    if (status === "deal_closed") {
      const confirmed = window.confirm(
        "確定標記為「成功入住（結案）」嗎？\n\n對應樓盤將自動設為「已租出」並全線下架。"
      );
      if (!confirmed) return;
    }

    setSaving(true);
    try {
      const result = await adminUpdateOfflineDealAction({
        groupId: group.groupId,
        status,
        viewingTime: toIsoFromDatetimeLocal(viewingTimeLocal),
        viewingNotes,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      if (status === "deal_closed") {
        toast.success("已結案！樓盤已標記為已租出，前台租客將看到入住完成狀態。");
      } else if (viewingTimeLocal.trim()) {
        toast.success("已儲存。前台租客將同步看到最新睇樓時間與進度。");
      } else {
        toast.success("線下追蹤資料已儲存。");
      }

      onOpenChange(false);
      router.refresh();
    } catch (e) {
      console.error("[DealManagementModal] save", e);
      toast.error("儲存時發生錯誤。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>🛎️ 線下追蹤控制台</DialogTitle>
          <DialogDescription>
            {group
              ? `${group.propertyTitle} · ${group.memberCount} 人已成團`
              : "管理線下帶看、簽約與結案流程。"}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-600">
            <Loader2 className="size-5 animate-spin" aria-hidden />
            載入線下追蹤資料中…
          </div>
        ) : loadError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {loadError}
          </div>
        ) : (
          <div className="space-y-5 py-1">
            <div className="space-y-2">
              <Label htmlFor="deal-status">更改狀態</Label>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as AdminOfflineDealStatus)}
                disabled={saving}
              >
                <SelectTrigger id="deal-status" className="w-full">
                  <SelectValue placeholder="選擇線下進度" />
                </SelectTrigger>
                <SelectContent>
                  {ADMIN_OFFLINE_DEAL_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {ADMIN_OFFLINE_DEAL_STATUS_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {status === "deal_closed" ? (
                <p className="text-xs text-emerald-700">
                  儲存後將自動把對應樓盤標記為「已租出」。
                </p>
              ) : null}
              {status === "viewing_failed" ? (
                <p className="text-xs text-red-700">
                  儲存後將開啟成員選擇視窗，請指定哪位室友反悔並踢出。
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="deal-viewing-time" className="flex items-center gap-1.5">
                <CalendarClock className="size-4 text-[#0f2540]" aria-hidden />
                設定睇樓時間
              </Label>
              <Input
                id="deal-viewing-time"
                type="datetime-local"
                value={viewingTimeLocal}
                onChange={(e) => setViewingTimeLocal(e.target.value)}
                disabled={saving}
                className="font-mono text-sm"
              />
              <p className="text-xs text-zinc-500">
                設定後，前台租客在「約定睇樓」階段將看到此時間。
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="deal-notes" className="flex items-center gap-1.5">
                <ClipboardList className="size-4 text-[#0f2540]" aria-hidden />
                記事本（管家內部備註）
              </Label>
              <Textarea
                id="deal-notes"
                value={viewingNotes}
                onChange={(e) => setViewingNotes(e.target.value)}
                placeholder="例：業主週六下午可帶看；A 室友需改期…"
                rows={4}
                disabled={saving}
                className="resize-y"
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            取消
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={loading || saving || Boolean(loadError) || !group}
            className="gap-1.5 bg-[#0f2540] text-white hover:bg-[#1a3a5c]"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                儲存中…
              </>
            ) : (
              <>
                <Save className="size-4" aria-hidden />
                儲存變更
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <KickMemberModal
      open={kickModalOpen}
      onOpenChange={setKickModalOpen}
      group={group}
      viewingNotes={viewingNotes}
      onSuccess={() => onOpenChange(false)}
    />
  </>
  );
}
