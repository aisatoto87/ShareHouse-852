"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Check, Loader2, MoreVertical } from "lucide-react";
import { toast } from "sonner";
import { isAdminUser } from "@/lib/admin-auth";
import { createSupabaseBrowserClient, getBrowserUser } from "@/lib/supabase/client";
import type { PropertyListingStatus } from "@/types/property";
import { cn } from "@/lib/utils";

type AdminCardActionsProps = {
  propertyId: string;
  currentStatus?: PropertyListingStatus;
  onStatusUpdated?: (status: PropertyListingStatus) => void;
  onDelete: () => void | Promise<void>;
  deleting?: boolean;
  /** 父層額外開關（如 Admin 密語解鎖）；仍會再驗證 Supabase Admin */
  enabled?: boolean;
  className?: string;
};

function stopMenuEvent(e: ReactMouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

export default function AdminCardActions({
  propertyId,
  currentStatus = "available",
  onStatusUpdated,
  onDelete,
  deleting = false,
  enabled = true,
  className,
}: AdminCardActionsProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { user } = await getBrowserUser(supabase);
      if (!active) return;
      setCanManage(isAdminUser(user));
      setAuthChecked(true);
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: globalThis.MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const busy = statusLoading || deleting;

  const allowed = enabled || canManage;
  if (!authChecked || !allowed) {
    return null;
  }

  async function applyStatus(nextStatus: PropertyListingStatus, e: ReactMouseEvent) {
    stopMenuEvent(e);
    if (busy || nextStatus === currentStatus) {
      setOpen(false);
      return;
    }

    setStatusLoading(true);
    setOpen(false);

    try {
      const { data, error } = await supabase
        .from("properties")
        .update({ status: nextStatus })
        .eq("id", propertyId)
        .select("id, status");

      if (error) {
        console.error("[AdminCardActions] status update", error);
        toast.error(`更新狀態失敗：${error.message}`);
        return;
      }

      if (!data?.length) {
        toast.error("更新失敗：權限不足或找不到該租盤");
        return;
      }

      const labels: Record<PropertyListingStatus, string> = {
        available: "🟢 重新上架",
        held: "⏳ Hold 起配對",
        rented: "⛔ 標記已租出",
      };
      toast.success(`已更新為：${labels[nextStatus]}`);
      onStatusUpdated?.(nextStatus);
      router.refresh();
    } finally {
      setStatusLoading(false);
    }
  }

  function handleEdit(e: ReactMouseEvent) {
    stopMenuEvent(e);
    setOpen(false);
    router.push(`/edit-property/${propertyId}`);
  }

  async function handleDeleteClick(e: ReactMouseEvent) {
    stopMenuEvent(e);
    setOpen(false);

    if (!window.confirm("確定要刪除此租盤嗎？")) {
      return;
    }

    try {
      await onDelete();
      router.refresh();
    } catch (err) {
      console.error("[AdminCardActions] delete", err);
      toast.error("刪除失敗，請稍後再試。");
    }
  }

  function menuItemClass(active: boolean) {
    return cn(
      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-50 disabled:opacity-50",
      active && "bg-[#0f2540]/5 font-medium text-[#0f2540]"
    );
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        title="管家操作"
        aria-label="管家操作選單"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={busy}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/40",
          "bg-white/80 text-zinc-800 shadow-sm backdrop-blur-sm transition-colors",
          "hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
          "disabled:cursor-not-allowed disabled:opacity-70"
        )}
        onClick={(e) => {
          stopMenuEvent(e);
          setOpen((prev) => !prev);
        }}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <MoreVertical className="h-4 w-4" />
        )}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-[60] mb-1.5 max-h-[min(70vh,20rem)] w-56 overflow-y-auto rounded-xl border border-zinc-200/90 bg-white py-1 shadow-xl ring-1 ring-black/5"
          onClick={stopMenuEvent}
          onMouseDown={stopMenuEvent}
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-zinc-800 transition-colors hover:bg-zinc-50"
            onClick={handleEdit}
          >
            ✏️ 編輯租盤
          </button>

          <div className="my-1 border-t border-zinc-100" role="separator" />
          <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            盤源狀態
          </p>

          <button
            type="button"
            role="menuitem"
            disabled={busy}
            className={menuItemClass(currentStatus === "available")}
            onClick={(e) => void applyStatus("available", e)}
          >
            <span className="flex-1">🟢 重新上架</span>
            {currentStatus === "available" ? (
              <Check className="h-4 w-4 shrink-0 text-emerald-600" />
            ) : null}
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={busy}
            className={menuItemClass(currentStatus === "held")}
            onClick={(e) => void applyStatus("held", e)}
          >
            <span className="flex-1">⏳ Hold 起配對</span>
            {currentStatus === "held" ? (
              <Check className="h-4 w-4 shrink-0 text-emerald-600" />
            ) : null}
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={busy}
            className={menuItemClass(currentStatus === "rented")}
            onClick={(e) => void applyStatus("rented", e)}
          >
            <span className="flex-1">⛔ 標記已租出</span>
            {currentStatus === "rented" ? (
              <Check className="h-4 w-4 shrink-0 text-emerald-600" />
            ) : null}
          </button>

          <div className="my-1 border-t border-zinc-100" role="separator" />
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
            onClick={(e) => void handleDeleteClick(e)}
          >
            🗑️ 刪除此租盤
          </button>
        </div>
      ) : null}
    </div>
  );
}
