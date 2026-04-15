import type { Metadata } from "next";
import { Noto_Sans_HK } from "next/font/google";
import FloatingContact from "@/components/FloatingContact";
import RoleOnboardingGate from "@/components/RoleOnboardingGate";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const notoSansHK = Noto_Sans_HK({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ShareHouse 852",
  description: "香港一站式合租管家服務",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-HK" className={notoSansHK.variable}>
      <body className={`${notoSansHK.className} antialiased`} suppressHydrationWarning>
        <RoleOnboardingGate />
        {children}
        <FloatingContact />
        <Toaster richColors position="top-center" closeButton />
      </body>
    </html>
  );
}
