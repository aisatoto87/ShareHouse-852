import Link from "next/link";
import { redirect } from "next/navigation";
import Navbar from "@/components/Navbar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { markInquiryContacted } from "@/app/admin/inquiries/actions";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

type InquiryRow = {
  id: string;
  created_at: string;
  name: string | null;
  contact_info: string | null;
  message: string | null;
  status: string | null;
  property_id: string | null;
  properties: { id: string; title: string | null } | null;
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";

  const parts = new Intl.DateTimeFormat("zh-HK", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}`;
}

function normalizeStatus(status: string | null) {
  const value = (status ?? "pending").toLowerCase();
  if (value === "contacted") {
    return {
      label: "Contacted",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      isPending: false,
    };
  }
  return {
    label: "Pending",
    className: "border-amber-200 bg-amber-50 text-amber-700",
    isPending: true,
  };
}

function propertyLabel(inquiry: any) {
  let title = "未關聯租盤";
  
  // 🛡️ 防彈邏輯：無論 Supabase 畀 Array 定 Object 我哋都食得落！
  const titleText = Array.isArray(inquiry.properties) 
    ? inquiry.properties[0]?.title 
    : inquiry.properties?.title;

  // 安全檢查：確保 titleText 真係存在，而且係一段字
  if (titleText && typeof titleText === "string" && titleText.trim()) {
    title = titleText.trim();
  } else if (inquiry.property_id) {
    // 加個 String() 保障，萬一 id 唔係字串都唔會炒車
    title = `租盤 #${String(inquiry.property_id).slice(0, 8)}`;
  }

  return (
    <Link 
      href={`/property/${inquiry.property_id}`} 
      target="_blank" 
      className="font-medium text-blue-600 transition-colors hover:text-blue-800 hover:underline"
    >
      {title} ↗
    </Link>
  );
}
export default async function AdminInquiriesPage() {
  // 👇 將呢段靈魂神經線貼喺度！
  async function markAsContacted(formData: FormData) {
    "use server";
    const id = formData.get("inquiryId") as string;
    const supabase = await createSupabaseServerClient();
    
    // 將資料庫嘅 status 更新為 contacted
    await supabase.from("inquiries").update({ status: "contacted" }).eq("id", id);
    
    // 叫 Next.js 即刻重新載入呢一頁嘅最新資料 (記得檔案最頂要有 import { revalidatePath } from "next/cache";)
    revalidatePath("/admin/inquiries"); 
  }

  // ... 下面繼續係你原本嘅 const supabase = await createSupabaseServerClient(); 等等 ...
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const VIP_EMAILS = [
    "aisatoto87@gmail.com", 
    "mowangmw@gmail.com",
    "yushinghei1021@gmail.com"
  ];

    const isAdmin = 
    VIP_EMAILS.includes(user?.email || "") || 
    (Boolean(user) && (
      user?.app_metadata?.role === "admin" ||
      user?.user_metadata?.role === "admin" ||
      user?.app_metadata?.is_admin === true ||
      user?.user_metadata?.is_admin === true
    ));  

    if (!isAdmin) {
    redirect("/");
  }

  const { data, error } = await supabase
    .from("inquiries")
    .select("id, created_at, name, contact_info, message, status, property_id, properties(id, title)")
    .order("created_at", { ascending: false });

    const inquiries = ((data ?? []) as unknown as InquiryRow[]).filter((row) => row.id);

  return (
    <div className="min-h-screen bg-zinc-50">
      <Navbar />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 sm:py-10">
        <section className="rounded-2xl border border-[#0f2540]/15 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight text-[#0f2540]">管家預約查詢後台</h1>
          <p className="mt-2 text-sm text-zinc-500">
            集中管理客人預約與查詢，並快速標記跟進狀態。
          </p>
        </section>

        <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          {error ? (
            <div className="p-6 text-sm text-red-600">
              讀取 inquiries 失敗：{error.message}
            </div>
          ) : inquiries.length === 0 ? (
            <div className="p-10 text-center text-sm text-zinc-500">
              目前尚未有任何預約或查詢紀錄。
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-200 text-sm">
                <thead className="bg-zinc-50/80 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-3">提交日期</th>
                    <th className="px-4 py-3">客人姓名</th>
                    <th className="px-4 py-3">聯絡方式</th>
                    <th className="px-4 py-3">想看哪個盤</th>
                    <th className="px-4 py-3">查詢內容</th>
                    <th className="px-4 py-3">目前狀態</th>
                    <th className="px-4 py-3 text-right">跟進行動</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {inquiries.map((inquiry) => {
                    const status = normalizeStatus(inquiry.status);
                    const propertyId = inquiry.properties?.id ?? inquiry.property_id;

                    return (
                      <tr key={inquiry.id} className="align-top">
                        <td className="px-4 py-4 text-zinc-700 whitespace-nowrap">
                          {formatDateTime(inquiry.created_at)}
                        </td>
                        <td className="px-4 py-4 font-medium text-zinc-900">
                          {inquiry.name?.trim() || "--"}
                        </td>
                        <td className="px-4 py-4 text-zinc-700">
                          {inquiry.contact_info?.trim() || "--"}
                        </td>
                        <td className="px-4 py-4">
                          {propertyId ? (
                            <Link
                              href={`/property/${propertyId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-[#0f2540] underline-offset-2 hover:underline"
                            >
                              {propertyLabel(inquiry)}
                            </Link>
                          ) : (
                            <span className="text-zinc-500">{propertyLabel(inquiry)}</span>
                          )}
                        </td>
                        <td className="max-w-sm px-4 py-4 text-zinc-700">
                          <p className="whitespace-pre-wrap break-words">
                            {inquiry.message?.trim() || "--"}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${status.className}`}
                          >
                            {status.label}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-right">
                        {(inquiry.status || "").toLowerCase() === "pending" ? (
  <form action={markAsContacted}>
    {/* 靜靜雞將個 ID 傳畀後台 */}
    <input type="hidden" name="inquiryId" value={inquiry.id} />
    <button 
      type="submit" 
      className="cursor-pointer rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-200"
    >
      Pending (按此跟進)
    </button>
  </form>
) : (
  <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-700">
    Contacted
  </span>
)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
