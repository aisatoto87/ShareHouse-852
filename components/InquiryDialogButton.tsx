"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type InquiryDialogButtonProps = {
  propertyId: string;
  className?: string;
};

export default function InquiryDialogButton({ propertyId, className }: InquiryDialogButtonProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [content, setContent] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const trimmedName = name.trim();
    const trimmedContact = contact.trim();
    const trimmedContent = content.trim();

    if (!trimmedName || !trimmedContact) {
      toast.error("請先填寫姓名及聯絡方式。");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          name: trimmedName,
          contact: trimmedContact,
          content: trimmedContent,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "提交失敗，請稍後再試。");
      }

      toast.success("預約已送出，我們的管家會盡快聯絡您！");
      setName("");
      setContact("");
      setContent("");
      setOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "提交失敗，請稍後再試。";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
      >
        預約睇樓
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md border-zinc-200 bg-white p-6">
          <DialogHeader className="gap-2">
            <DialogTitle className="text-lg text-zinc-900">預約睇樓 / 聯絡管家</DialogTitle>
            <DialogDescription className="text-sm text-zinc-600">
              請留下你的聯絡資料，我們會盡快安排跟進。
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            <div className="space-y-1.5">
              <label htmlFor="inquiry-name" className="text-sm font-medium text-zinc-700">
                姓名
              </label>
              <Input
                id="inquiry-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：陳大文"
                required
                disabled={submitting}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="inquiry-contact" className="text-sm font-medium text-zinc-700">
                聯絡方式（電話或微信號）
              </label>
              <Input
                id="inquiry-contact"
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                placeholder="例如：9123 4567 / wechat_id"
                required
                disabled={submitting}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="inquiry-content" className="text-sm font-medium text-zinc-700">
                預約時間 / 查詢內容
              </label>
              <Textarea
                id="inquiry-content"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="例如：想約星期六下午睇樓，兩位女生同住..."
                disabled={submitting}
                rows={5}
              />
            </div>

            <Button
              type="submit"
              className="h-11 w-full bg-[#0f2540] text-white hover:bg-[#1a3a5c]"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  送出中...
                </>
              ) : (
                "送出預約"
              )}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
