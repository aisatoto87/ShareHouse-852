import { Suspense } from "react";
import LoginPageClient from "./LoginPageClient";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#061833] via-[#0b2545] to-[#102f57] px-4 py-8">
          <p className="text-sm text-blue-100/80">載入中…</p>
        </main>
      }
    >
      <LoginPageClient />
    </Suspense>
  );
}
