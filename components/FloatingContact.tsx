"use client";

import { useState } from "react";
import { MessageCircle, MessageSquare } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const WHATSAPP_LINK = "https://wa.me/85212345678";

export default function FloatingContact() {
  const [wechatOpen, setWechatOpen] = useState(false);

  return (
    <>
      <div className="fixed right-6 bottom-6 z-[70] flex flex-col gap-3">
        <a
          href={WHATSAPP_LINK}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="透過 WhatsApp 聯絡客服"
          className="flex size-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition hover:scale-105 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2"
        >
          <MessageCircle className="size-7" aria-hidden />
        </a>

        <Button
          type="button"
          size="icon-lg"
          aria-label="開啟 WeChat 客服資訊"
          onClick={() => setWechatOpen(true)}
          className="rounded-full bg-[#07C160] text-white shadow-lg hover:scale-105 hover:bg-[#06ad57] hover:shadow-xl"
        >
          <MessageSquare className="size-7" aria-hidden />
        </Button>
      </div>

      <Dialog open={wechatOpen} onOpenChange={setWechatOpen}>
        <DialogContent className="max-w-sm border-zinc-200 bg-white p-6">
          <DialogHeader className="gap-3">
            <DialogTitle className="text-lg text-zinc-900">
              WeChat 客服
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-zinc-600">
              請添加我們的客服微信：ShareHouse852_Admin
            </DialogDescription>
          </DialogHeader>

          <div className="mx-auto mt-1 size-[200px] rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-100" />
        </DialogContent>
      </Dialog>
    </>
  );
}
