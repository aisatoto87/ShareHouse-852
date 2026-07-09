"use client";

import { useRouter } from "next/navigation";
import ChatReportsPanel from "@/components/admin/ChatReportsPanel";
import EscalatedNudgesPanel from "@/components/admin/EscalatedNudgesPanel";

export default function AdminModerationClient() {
  const router = useRouter();

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[#0f2540]/15 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight text-[#0f2540]">
          投訴與審查中心
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          集中處理室友糾紛升級工單與 P2P 私聊惡意行為舉報。
        </p>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <EscalatedNudgesPanel
          className="mb-0 h-fit"
          onOpenDirectChat={(roomId) => {
            router.push(`/admin/inbox?room=${encodeURIComponent(roomId)}`);
          }}
        />
        <ChatReportsPanel className="h-fit" />
      </div>
    </div>
  );
}
