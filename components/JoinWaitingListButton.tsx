"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type JoinWaitingListButtonProps = {
  propertyId: string;
  className?: string;
};

export default function JoinWaitingListButton({ propertyId, className }: JoinWaitingListButtonProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [queued, setQueued] = useState(false);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadQueueState() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!active) return;

      if (!user) {
        setQueued(false);
        setChecking(false);
        return;
      }

      const { data, error } = await supabase
        .from("property_applications")
        .select("id")
        .eq("user_id", user.id)
        .eq("property_id", propertyId)
        .limit(1)
        .maybeSingle();

      if (!active) return;

      if (error) {
        console.error("[JoinWaitingList] fetch queue state", error);
        toast.error("讀取排隊狀態失敗，請稍後再試。");
        setChecking(false);
        return;
      }

      setQueued(Boolean(data));
      setChecking(false);
    }

    void loadQueueState();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void loadQueueState();
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [propertyId, supabase]);

  async function handleJoinWaitingList() {
    if (checking || submitting || queued) return;

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      toast.error("讀取登入狀態失敗，請稍後再試。");
      return;
    }

    if (!user) {
      router.push("/login");
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.from("property_applications").insert({
        user_id: user.id,
        property_id: propertyId,
      });

      if (error) {
        if (error.code === "23505") {
          setQueued(true);
          return;
        }
        throw error;
      }

      setQueued(true);
      toast.success("成功加入排隊！當有高契合度的室友時我們會立即通知您！");
    } catch (e) {
      console.error("[JoinWaitingList] insert", e);
      toast.error("加入排隊失敗，請稍後再試。");
    } finally {
      setSubmitting(false);
    }
  }

  if (queued) {
    return (
      <Button type="button" disabled className={className}>
        🕒 已在排隊名單中
      </Button>
    );
  }

  return (
    <Button
      type="button"
      onClick={() => void handleJoinWaitingList()}
      disabled={checking || submitting}
      className={className}
    >
      {submitting ? (
        <>
          <Loader2 className="size-4 animate-spin shrink-0" aria-hidden />
          處理中…
        </>
      ) : checking ? (
        <>
          <Loader2 className="size-4 animate-spin shrink-0" aria-hidden />
          載入中…
        </>
      ) : (
        "✨ 加入心水排隊區 (Join Waiting List)"
      )}
    </Button>
  );
}
