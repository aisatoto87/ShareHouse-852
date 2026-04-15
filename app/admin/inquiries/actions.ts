"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function markInquiryContacted(formData: FormData) {
  const inquiryId = String(formData.get("inquiryId") ?? "").trim();
  if (!inquiryId) return;

  const supabase = await createSupabaseServerClient();

  await supabase
    .from("inquiries")
    .update({ status: "contacted" })
    .eq("id", inquiryId)
    .eq("status", "pending");

  revalidatePath("/admin/inquiries");
}
