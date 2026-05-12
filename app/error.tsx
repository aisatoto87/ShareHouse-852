"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/error]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#0a1628] via-[#0f2540] to-[#0f2540] px-4 py-16 text-zinc-100">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/[0.06] p-8 shadow-2xl shadow-black/40 backdrop-blur-md sm:p-10">
        <h1 className="text-center text-xl font-bold tracking-tight text-white sm:text-2xl">
          哎呀！系統遇到了一點小亂流 🌪️
        </h1>
        <p className="mt-4 text-center text-sm leading-relaxed text-zinc-300 sm:text-base">
          別擔心，這通常只是暫時的網絡或連線狀況，不是你的操作有問題。稍後再試一次，畫面多半就能恢復正常。
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#0f2540] shadow-lg shadow-black/20 transition hover:bg-zinc-100 active:scale-[0.98]"
          >
            <span aria-hidden>🔄</span>
            重新嘗試
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/10 active:scale-[0.98]"
          >
            <span aria-hidden>🏠</span>
            返回首頁
          </Link>
        </div>
        <p className="mt-10 break-all text-center text-[10px] leading-relaxed text-zinc-500/50 sm:text-xs">
          {error.message}
        </p>
      </div>
    </div>
  );
}
