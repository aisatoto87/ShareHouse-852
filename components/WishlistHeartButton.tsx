"use client";

import { useEffect, useRef, useState } from "react";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";

type HeartVariant = "onImage" | "onNavy" | "onLight";

const variantClass: Record<HeartVariant, string> = {
  onImage:
    "border-white/35 bg-black/30 text-white backdrop-blur-md hover:bg-black/45 focus-visible:outline-white",
  onNavy:
    "border-white/30 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20 focus-visible:outline-white",
  onLight:
    "border-zinc-200 bg-white text-zinc-600 shadow-sm hover:bg-zinc-50 focus-visible:outline-[#0f2540]",
};

interface WishlistHeartButtonProps {
  propertyId: string;
  variant?: HeartVariant;
  className?: string;
  stopPropagation?: boolean;
  /** 已租出等狀態下禁用互動 */
  disabled?: boolean;
  "aria-label"?: string;
}

export default function WishlistHeartButton({
  propertyId,
  variant = "onLight",
  className,
  stopPropagation = false,
  disabled: disabledProp = false,
  "aria-label": ariaLabel,
}: WishlistHeartButtonProps) {
  const { user, loading: authLoading, supabase } = useAuth();
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const mutatingRef = useRef(false);

  useEffect(() => {
    let active = true;

    async function loadSavedState() {
      if (authLoading) return;

      if (!user) {
        if (!active) return;
        setSaved(false);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("favorites")
        .select("id")
        .eq("user_id", user.id)
        .eq("property_id", propertyId)
        .limit(1)
        .maybeSingle();

      if (!active) return;

      if (error) {
        toast.error("讀取心水狀態失敗，請稍後再試。");
        setLoading(false);
        return;
      }

      setSaved(Boolean(data));
      setLoading(false);
    }

    void loadSavedState();

    return () => {
      active = false;
    };
  }, [propertyId, supabase, user, authLoading]);

  async function handleToggle() {
    if (disabledProp || loading || mutatingRef.current) return;

    if (!user) {
      toast.info("請先登入以加入心水清單");
      return;
    }

    const previous = saved;
    const next = !previous;
    setSaved(next);

    mutatingRef.current = true;

    if (next) {
      const { error } = await supabase.from("favorites").insert({
        user_id: user.id,
        property_id: propertyId,
      });

      if (error) {
        setSaved(previous);
        toast.error("加入心水清單失敗，請稍後再試。");
        mutatingRef.current = false;
        return;
      }
      toast.success("已加入心水清單");
      mutatingRef.current = false;
      return;
    }

    const { error } = await supabase
      .from("favorites")
      .delete()
      .eq("user_id", user.id)
      .eq("property_id", propertyId);

    if (error) {
      setSaved(previous);
      toast.error("移除心水清單失敗，請稍後再試。");
    } else {
      toast.success("已從心水清單移除");
    }
    mutatingRef.current = false;
  }

  return (
    <button
      type="button"
      disabled={loading || disabledProp}
      className={cn(
        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-70",
        variantClass[variant],
        saved &&
          (variant === "onImage" || variant === "onNavy") &&
          "border-rose-300/40 text-rose-300",
        saved && variant === "onLight" && "border-rose-200 text-rose-600",
        className
      )}
      aria-label={ariaLabel ?? (saved ? "從心水清單移除" : "加入心水清單")}
      aria-pressed={saved}
      onClick={(e) => {
        if (stopPropagation) {
          e.preventDefault();
          e.stopPropagation();
        }
        void handleToggle();
      }}
    >
      <Heart
        className={cn("h-[1.15rem] w-[1.15rem] transition-transform", saved && "scale-105")}
        fill={saved ? "currentColor" : "none"}
        strokeWidth={saved ? 0 : 2}
      />
    </button>
  );
}
