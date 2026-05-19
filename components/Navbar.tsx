"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session, User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { hasManagerNavbarAccess } from "@/lib/user-roles";

const navTextLinkClass =
  "inline-flex items-center rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100";

export default function Navbar() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [profileRole, setProfileRole] = useState<string>("");

  const showManagerPortal = hasManagerNavbarAccess(user, profileRole);

  useEffect(() => {
    let mounted = true;

    const applySession = async (session: Session | null) => {
      const nextUser = session?.user ?? null;
      if (!mounted) return;
      setUser(nextUser);
      if (!nextUser) {
        setProfileRole("");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", nextUser.id)
        .maybeSingle();
      if (!mounted) return;
      setProfileRole(typeof profile?.role === "string" ? profile.role : "");
    };

    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!mounted) return;
      await applySession(session);
    };

    void checkSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  async function handleSignOut() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      toast.error(error.message || "登出失敗，請稍後再試。");
      return;
    }

    setUser(null);
    setProfileRole("");
    toast.success("已登出");
    router.push("/");
    router.refresh();
  }

  function handleListPropertyClick() {
    if (!user) {
      router.push("/login");
      return;
    }

    if (profileRole === "tenant") {
      toast.error("抱歉，租客帳號無法放盤。如有需要，請使用業主帳號登入！");
      return;
    }

    router.push("/list-property");
  }

  return (
    <nav className="sticky top-0 z-50 border-b border-zinc-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="group flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0f2540] text-sm font-medium text-white transition-opacity group-hover:opacity-80">
            S
          </div>
          <div>
            <p className="text-[15px] font-semibold leading-tight tracking-tight text-zinc-900">
              ShareHouse 852
            </p>
            <p className="text-[11px] leading-tight text-zinc-400">合租管家服務</p>
          </div>
        </Link>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Button
            type="button"
            onClick={handleListPropertyClick}
            className="rounded-full bg-[#0f2540] px-3 py-1.5 text-sm text-white hover:bg-[#1a3a5c]"
          >
            免費放盤
          </Button>

          {user && showManagerPortal ? (
            <Link href="/admin" className={navTextLinkClass}>
              管家後台
            </Link>
          ) : null}

          {user ? (
            <>
              <Link href="/wishlist" className={navTextLinkClass}>
                心水清單
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center rounded-full border border-[#12355f] bg-[#0f2540] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
              >
                我的帳號
              </Link>
              <Button
                type="button"
                variant="outline"
                onClick={handleSignOut}
                className="rounded-full border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
              >
                登出
              </Button>
            </>
          ) : (
            <>
              <Link href="/login" className={navTextLinkClass}>
                登入
              </Link>
              <Link
                href="/register"
                className="inline-flex items-center rounded-full border border-[#12355f] bg-[#0f2540] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
              >
                註冊
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
