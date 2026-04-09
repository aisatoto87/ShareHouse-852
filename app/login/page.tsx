"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, type FormEvent, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    if (searchParams.get("error") === "oauth_callback_failed") {
      toast.error("Google 登入回調失敗，請再試一次。");
    }
  }, [searchParams]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      toast.error(error.message || "登入失敗，請檢查帳號密碼。");
      return;
    }

    toast.success("登入成功");
    router.push("/");
    router.refresh();
  }

  async function handleGoogleLogin() {
    setGoogleLoading(true);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback`,
      },
    });

    if (error) {
      setGoogleLoading(false);
      toast.error(error.message || "Google 登入失敗，請稍後再試。");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#061833] via-[#0b2545] to-[#102f57] px-4 py-8">
      <Card className="w-full max-w-md border-[#1f3e67] bg-[#0a1f3d] text-white shadow-2xl">
        <CardContent className="space-y-6 p-6">
          <div className="space-y-1 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">會員登入</h1>
            <p className="text-sm text-blue-100/80">登入後可管理收藏與帳號資料</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-blue-50">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="例如：name@qq.com 或 name@gmail.com"
                required
                className="h-10 border-[#2a4b77] bg-[#0d2b50] text-white placeholder:text-blue-100/60"
              />
              <p className="text-xs text-muted-foreground">
                * 內地同學建議使用 QQ 或 163 郵箱註冊
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-blue-50">
                密碼
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                required
                className="h-10 border-[#2a4b77] bg-[#0d2b50] text-white placeholder:text-blue-100/60"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="h-10 w-full bg-[#2f69b2] text-white hover:bg-[#3b78c4]"
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : "登入"}
            </Button>
          </form>

          <div className="relative">
            <Separator className="bg-[#2a4b77]" />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#0a1f3d] px-2 text-xs text-blue-100/75">
              Or continue with
            </span>
          </div>

          <Button
            type="button"
            variant="outline"
            disabled={googleLoading}
            onClick={handleGoogleLogin}
            className="h-10 w-full border-[#2a4b77] bg-[#13345f] text-white hover:bg-[#18406f]"
          >
            {googleLoading ? <Loader2 className="size-4 animate-spin" /> : null}
            使用 Google 帳號登入
          </Button>

          <p className="text-center text-sm text-blue-100/80">
            還沒有帳號？{" "}
            <Link href="/register" className="font-semibold text-blue-200 hover:text-white">
              立即註冊
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
