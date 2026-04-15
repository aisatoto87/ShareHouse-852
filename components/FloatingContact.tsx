"use client";

import { useState, type SVGProps } from "react";
import { MessageCircle } from "lucide-react";
import BackToTopButton from "@/components/BackToTopButton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const WHATSAPP_LINK = "https://wa.me/85212345678";

function WeChatIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M9.297 2C4.714 2 1 4.969 1 8.632c0 2.105 1.248 3.979 3.194 5.196l-1.045 3.17 3.757-1.886c.77.189 1.571.287 2.391.287 4.583 0 8.297-2.969 8.297-6.633S13.88 2 9.297 2Zm-2.65 4.742a.87.87 0 1 1 0 1.739.87.87 0 0 1 0-1.739Zm5.3 0a.87.87 0 1 1 0 1.739.87.87 0 0 1 0-1.739Z" />
      <path d="M16.721 10.655c-3.468 0-6.279 2.226-6.279 4.972 0 1.568.918 2.965 2.347 3.889l-.767 2.484 2.841-1.41c.604.142 1.227.216 1.858.216 3.468 0 6.279-2.226 6.279-4.972 0-2.747-2.811-4.973-6.279-4.973Zm-2.023 3.624a.677.677 0 1 1 0 1.353.677.677 0 0 1 0-1.353Zm4.058 0a.677.677 0 1 1 0 1.353.677.677 0 0 1 0-1.353Z" />
    </svg>
  );
}

export default function FloatingContact() {
  const [wechatOpen, setWechatOpen] = useState(false);
  const actionButtonClassName =
    "flex size-14 items-center justify-center rounded-full text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

  return (
    <>
      <div className="fixed right-6 bottom-6 z-[70] flex flex-col items-center gap-3">
        <a
          href={WHATSAPP_LINK}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="透過 WhatsApp 聯絡客服"
          className={`${actionButtonClassName} bg-[#25D366] focus-visible:ring-[#25D366]`}
        >
          <MessageCircle className="size-7" aria-hidden />
        </a>

        <Button
          type="button"
          size="icon-lg"
          aria-label="開啟 WeChat 客服資訊"
          onClick={() => setWechatOpen(true)}
          className={`${actionButtonClassName} bg-[#07C160] hover:bg-[#06ad57] focus-visible:ring-[#07C160]`}
        >
          <WeChatIcon className="size-7" />
        </Button>

        <BackToTopButton />
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
