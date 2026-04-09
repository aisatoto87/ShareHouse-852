"use client";

import { MessageCircle } from "lucide-react";

interface MobilePropertyStickyCtaProps {
  waUrl: string;
  title: string;
}

export default function MobilePropertyStickyCta({ waUrl, title }: MobilePropertyStickyCtaProps) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-4px_24px_rgba(15,37,64,0.08)] md:hidden">
      <a
        href={waUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0f2540] px-4 py-3.5 text-base font-semibold text-white shadow-md transition-colors hover:bg-[#1a3a5c] active:bg-[#0c1d33]"
        aria-label={`以 WhatsApp 申請合租媒合 — ${title}`}
      >
        <MessageCircle className="h-5 w-5 shrink-0" />
        申請合租媒合
      </a>
    </div>
  );
}
