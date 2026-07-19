"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  adminCreateVirtualMatchGroupAction,
  getAdminWaitingPoolAction,
} from "@/app/admin/groups/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  WaitingPoolPropertyGroup,
  WaitingPoolUser,
} from "@/lib/admin-waiting-pool";
import { cn } from "@/lib/utils";

type MatchMode = "by_property" | "global";

type ManualMatchModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 開啟時可預選某樓盤（例如「同樓盤再成團」） */
  prefillPropertyId?: string | null;
};

function formatHabit(value: number | null): string {
  return value != null ? String(value) : "—";
}

function UserRow({
  user,
  checked,
  disabled,
  showProperty,
  onToggle,
}: {
  user: WaitingPoolUser;
  checked: boolean;
  disabled: boolean;
  showProperty?: boolean;
  onToggle: (userId: string, checked: boolean) => void;
}) {
  return (
    <li>
      <label
        className={cn(
          "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 transition-colors",
          checked
            ? "border-[#0f2540]/30 bg-[#0f2540]/[0.03]"
            : "border-zinc-200 bg-white hover:bg-zinc-50"
        )}
      >
        <Checkbox
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onToggle(user.userId, value === true)}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-zinc-900">{user.displayName}</span>
            <span className="font-mono text-[10px] text-zinc-400">
              {user.userId.slice(0, 8)}…
            </span>
            {user.phone ? (
              <Badge className="rounded-full border-zinc-200 bg-zinc-50 font-mono text-[10px] text-zinc-600">
                {user.phone}
              </Badge>
            ) : null}
            {user.allowSpillover ? (
              <Badge className="rounded-full border-green-200 bg-green-50 text-[10px] text-green-800">
                同意跨盤
              </Badge>
            ) : null}
          </div>
          {showProperty ? (
            <p className="mt-1 text-xs text-zinc-600">
              目前排隊：{user.propertyTitle}
            </p>
          ) : null}
          <p className="mt-1 text-[11px] text-zinc-400">
            排隊於{" "}
            {user.createdAt ? new Date(user.createdAt).toLocaleString("zh-HK") : "—"}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-zinc-600">
            <span className="rounded bg-zinc-100 px-1.5 py-0.5">
              整潔 {formatHabit(user.habits.cleanliness)}
            </span>
            <span className="rounded bg-zinc-100 px-1.5 py-0.5">
              空調 {formatHabit(user.habits.acTemp)}
            </span>
            <span className="rounded bg-zinc-100 px-1.5 py-0.5">
              訪客 {formatHabit(user.habits.guests)}
            </span>
            <span className="rounded bg-zinc-100 px-1.5 py-0.5">
              噪音 {formatHabit(user.habits.noise)}
            </span>
          </div>
        </div>
      </label>
    </li>
  );
}

export default function ManualMatchModal({
  open,
  onOpenChange,
  prefillPropertyId = null,
}: ManualMatchModalProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<MatchMode>("by_property");
  const [groups, setGroups] = useState<WaitingPoolPropertyGroup[]>([]);
  const [allUsers, setAllUsers] = useState<WaitingPoolUser[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [targetPropertyId, setTargetPropertyId] = useState<string | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());

  const selectedGroup = useMemo(
    () => groups.find((g) => g.propertyId === selectedPropertyId) ?? null,
    [groups, selectedPropertyId]
  );

  const targetGroup = useMemo(() => {
    if (mode === "by_property") return selectedGroup;
    return groups.find((g) => g.propertyId === targetPropertyId) ?? null;
  }, [mode, selectedGroup, groups, targetPropertyId]);

  const selectedCount = selectedUserIds.size;
  const targetSize = targetGroup?.targetSize ?? 2;
  const canSubmit =
    targetGroup != null && selectedCount >= targetSize && !submitting && !loading;

  const loadPool = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await getAdminWaitingPoolAction();
      if (!result.ok) {
        setLoadError(result.error);
        setGroups([]);
        setAllUsers([]);
        return;
      }
      const nextGroups = Array.isArray(result.groups) ? result.groups : [];
      const nextUsers = Array.isArray(result.users) ? result.users : [];
      setGroups(nextGroups);
      setAllUsers(nextUsers);

      const prefill =
        typeof prefillPropertyId === "string" && prefillPropertyId.trim()
          ? prefillPropertyId.trim()
          : null;

      setSelectedPropertyId((prev) => {
        if (prev && nextGroups.some((g) => g.propertyId === prev)) return prev;
        if (prefill && nextGroups.some((g) => g.propertyId === prefill)) return prefill;
        return nextGroups[0]?.propertyId ?? null;
      });

      setTargetPropertyId((prev) => {
        if (prev && nextGroups.some((g) => g.propertyId === prev)) return prev;
        if (prefill && nextGroups.some((g) => g.propertyId === prefill)) return prefill;
        return nextGroups[0]?.propertyId ?? null;
      });

      setSelectedUserIds(new Set());
    } catch (err) {
      console.error("[ManualMatchModal] load", err);
      setLoadError(err instanceof Error ? err.message : "讀取排隊池失敗");
      setGroups([]);
      setAllUsers([]);
    } finally {
      setLoading(false);
    }
  }, [prefillPropertyId]);

  useEffect(() => {
    if (!open) return;
    void loadPool();
  }, [open, loadPool]);

  useEffect(() => {
    if (!open) {
      setSelectedUserIds(new Set());
      setSubmitting(false);
      setLoadError(null);
      setMode("by_property");
    }
  }, [open]);

  function switchMode(next: MatchMode) {
    if (next === mode) return;
    setMode(next);
    setSelectedUserIds(new Set());
    if (next === "global" && !targetPropertyId && selectedPropertyId) {
      setTargetPropertyId(selectedPropertyId);
    }
  }

  function selectProperty(propertyId: string) {
    if (propertyId === selectedPropertyId) return;
    setSelectedPropertyId(propertyId);
    setSelectedUserIds(new Set());
  }

  function toggleUser(userId: string, checked: boolean) {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }

  function selectAllVisible() {
    if (mode === "by_property") {
      if (!selectedGroup) return;
      setSelectedUserIds(new Set(selectedGroup.users.map((u) => u.userId)));
      return;
    }
    setSelectedUserIds(new Set(allUsers.map((u) => u.userId)));
  }

  function clearSelection() {
    setSelectedUserIds(new Set());
  }

  async function handleConfirm() {
    if (!targetGroup || submitting) return;

    if (selectedCount < targetGroup.targetSize) {
      toast.error(
        `勾選人數不可少於目標成團人數（需 ≥ ${targetGroup.targetSize}，目前 ${selectedCount}）`
      );
      return;
    }

    if (!targetGroup.propertyId) {
      toast.error("請指定最終成團的目標樓盤。");
      return;
    }

    setSubmitting(true);
    try {
      const result = await adminCreateVirtualMatchGroupAction(
        targetGroup.propertyId,
        [...selectedUserIds]
      );
      if (!result.ok) {
        // Server Action 已轉譯 SyncNest clique 等 RPC 錯誤；直接顯示精確字串
        const errorMessage =
          typeof result.error === "string" && result.error.trim()
            ? result.error.trim()
            : "手動拉人成團失敗。";
        toast.error(errorMessage);
        return;
      }

      toast.success(
        `已建立虛擬成團（${result.currentSize} 人 → pending_opt_in）${
          result.pausedCount > 0 ? `，並暫停其他樓盤意向 ${result.pausedCount} 筆` : ""
        }`
      );
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      console.error("[ManualMatchModal] create", err);
      toast.error(err instanceof Error ? err.message : "手動拉人成團時發生未知錯誤");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b border-zinc-100 px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-[#0f2540]" />
            手動拉人成團
          </DialogTitle>
          <DialogDescription>
            勾選 waiting 用戶並指定目標樓盤；系統會呼叫{" "}
            <code className="text-xs">create_virtual_match_group</code>
            ，一步進入 <code className="text-xs">pending_opt_in</code>
            （24 小時生死鎖）。跨盤模式會先將來源意向改掛至目標樓盤。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5">
              <button
                type="button"
                disabled={submitting}
                onClick={() => switchMode("by_property")}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  mode === "by_property"
                    ? "bg-white text-[#0f2540] shadow-sm"
                    : "text-zinc-500 hover:text-zinc-800"
                )}
              >
                依樓盤
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => switchMode("global")}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  mode === "global"
                    ? "bg-white text-[#0f2540] shadow-sm"
                    : "text-zinc-500 hover:text-zinc-800"
                )}
              >
                全域排隊池
              </button>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-xs text-zinc-500">
                {loading
                  ? "正在載入排隊池…"
                  : mode === "by_property"
                    ? `共 ${groups.length} 個樓盤`
                    : `共 ${allUsers.length} 位 waiting 用戶`}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={loading || submitting}
                onClick={() => void loadPool()}
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                重新整理
              </Button>
            </div>
          </div>

          {loadError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {loadError}
            </div>
          ) : loading && groups.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              讀取排隊池中…
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-12 text-center text-sm text-zinc-500">
              目前沒有 status = waiting 且已指定樓盤的排隊用戶。
            </div>
          ) : mode === "by_property" ? (
            <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
              <aside className="space-y-1">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  樓盤分組
                </p>
                {groups.map((group) => {
                  const active = group.propertyId === selectedPropertyId;
                  const enough = group.waitingCount >= group.targetSize;
                  return (
                    <button
                      key={group.propertyId}
                      type="button"
                      onClick={() => selectProperty(group.propertyId)}
                      disabled={submitting}
                      className={cn(
                        "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                        active
                          ? "border-[#0f2540] bg-[#0f2540]/5 ring-1 ring-[#0f2540]/20"
                          : "border-zinc-200 bg-white hover:bg-zinc-50"
                      )}
                    >
                      <p className="line-clamp-2 text-sm font-medium text-zinc-900">
                        {group.propertyTitle}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        排隊 {group.waitingCount} / 目標 {group.targetSize}
                      </p>
                      {!enough ? (
                        <p className="mt-0.5 text-[11px] text-amber-700">人數未達目標</p>
                      ) : (
                        <p className="mt-0.5 text-[11px] text-emerald-700">可成團</p>
                      )}
                    </button>
                  );
                })}
              </aside>

              <div className="min-w-0">
                {selectedGroup ? (
                  <>
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-[#0f2540]">
                          {selectedGroup.propertyTitle}
                        </h3>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          目標成團{" "}
                          <span className="font-semibold text-zinc-700">
                            {selectedGroup.targetSize}
                          </span>{" "}
                          人 · 已勾選{" "}
                          <span
                            className={cn(
                              "font-semibold",
                              selectedCount >= selectedGroup.targetSize
                                ? "text-emerald-700"
                                : "text-amber-700"
                            )}
                          >
                            {selectedCount}
                          </span>
                        </p>
                        <Link
                          href={`/property/${selectedGroup.propertyId}`}
                          target="_blank"
                          className="mt-1 inline-block text-xs text-blue-600 hover:underline"
                        >
                          查看樓盤 ↗
                        </Link>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={submitting}
                          onClick={selectAllVisible}
                        >
                          全選
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={submitting || selectedCount === 0}
                          onClick={clearSelection}
                        >
                          清除
                        </Button>
                      </div>
                    </div>

                    {selectedCount > 0 && selectedCount < selectedGroup.targetSize ? (
                      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        防呆：勾選人數不可少於目標成團人數（還差{" "}
                        {selectedGroup.targetSize - selectedCount} 人）。
                      </div>
                    ) : null}

                    <ul className="space-y-2">
                      {selectedGroup.users.map((user) => (
                        <UserRow
                          key={user.intentId}
                          user={user}
                          checked={selectedUserIds.has(user.userId)}
                          disabled={submitting}
                          onToggle={toggleUser}
                        />
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="py-10 text-center text-sm text-zinc-500">
                    請從左側選擇樓盤。
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 px-4 py-3">
                <label className="block text-xs font-semibold text-zinc-600">
                  最終成團目標樓盤
                </label>
                <select
                  className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-[#0f2540] focus:ring-1 focus:ring-[#0f2540]/30"
                  value={targetPropertyId ?? ""}
                  disabled={submitting}
                  onChange={(e) => setTargetPropertyId(e.target.value || null)}
                >
                  <option value="" disabled>
                    請選擇目標樓盤
                  </option>
                  {groups.map((group) => (
                    <option key={group.propertyId} value={group.propertyId}>
                      {group.propertyTitle}（目標 {group.targetSize} 人）
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-[11px] text-zinc-500">
                  可勾選任意樓盤的 waiting 用戶；送出時會將其意向改掛至此樓盤再呼叫 RPC。
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-zinc-500">
                  目標成團{" "}
                  <span className="font-semibold text-zinc-700">{targetSize}</span> 人 ·
                  已勾選{" "}
                  <span
                    className={cn(
                      "font-semibold",
                      selectedCount >= targetSize ? "text-emerald-700" : "text-amber-700"
                    )}
                  >
                    {selectedCount}
                  </span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={submitting}
                    onClick={selectAllVisible}
                  >
                    全選
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={submitting || selectedCount === 0}
                    onClick={clearSelection}
                  >
                    清除
                  </Button>
                </div>
              </div>

              {selectedCount > 0 && selectedCount < targetSize ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  防呆：勾選人數不可少於目標成團人數（還差 {targetSize - selectedCount}{" "}
                  人）。
                </div>
              ) : null}

              <ul className="space-y-2">
                {allUsers.map((user) => (
                  <UserRow
                    key={user.intentId}
                    user={user}
                    checked={selectedUserIds.has(user.userId)}
                    disabled={submitting}
                    showProperty
                    onToggle={toggleUser}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-zinc-100 px-6 py-4 sm:gap-0">
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
            className="bg-[#0f2540] text-white hover:bg-[#1a3a5c]"
            disabled={!canSubmit}
            onClick={() => void handleConfirm()}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                成團中…
              </>
            ) : (
              `確認成團（${selectedCount}/${targetSize}）`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
