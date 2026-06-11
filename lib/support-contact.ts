/** ShareHouse 官方管家 WhatsApp（全站客服入口） */
export const SHAREHOUSE_WHATSAPP_URL = "https://wa.me/85212345678";

export function buildShareHouseConciergeWhatsAppUrl(context?: string): string {
  const msg = encodeURIComponent(
    context?.trim()
      ? `你好！我想透過 ShareHouse 852 管家了解租盤：${context.trim()}`
      : "你好！我想透過 ShareHouse 852 管家了解合租服務。"
  );
  return `${SHAREHOUSE_WHATSAPP_URL}?text=${msg}`;
}
