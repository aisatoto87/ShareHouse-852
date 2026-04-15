import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type InquiryPayload = {
  propertyId?: unknown;
  name?: unknown;
  contact?: unknown;
  content?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as InquiryPayload;
    const propertyId = typeof body.propertyId === "string" ? body.propertyId.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const contact = typeof body.contact === "string" ? body.contact.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";

    if (!propertyId || !name || !contact) {
      return NextResponse.json({ error: "請完整填寫必填資料。" }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from("inquiries").insert({
      property_id: propertyId,
      user_id: user?.id ?? null,
      name,
      contact_info: contact,
      message: content || null,
    });

    if (error) console.log("🚨 Supabase 真正死因：", error);

    if (error) {
      return NextResponse.json({ error: error.message || "提交失敗，請稍後再試。" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.log("🚨 API 系統錯誤：", e);
    return NextResponse.json({ error: "提交失敗，請稍後再試。" }, { status: 500 });
  }
}
