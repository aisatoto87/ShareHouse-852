"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  createSupabaseBrowserClient,
  getBrowserUser,
} from "@/lib/supabase/client";

/**
 * Probes auth once on load. If refresh token is invalid, clears local session
 * and redirects to login so client trees (Navbar, onboarding gate) do not crash.
 */
export default function AuthSessionRecovery() {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;

    void (async () => {
      const { invalidSession } = await getBrowserUser(supabase);
      if (!invalidSession || handledRef.current) return;

      handledRef.current = true;
      if (pathname.startsWith("/login") || pathname.startsWith("/register")) {
        return;
      }

      const loginUrl =
        pathname === "/"
          ? "/login?reason=session_expired"
          : `/login?reason=session_expired&next=${encodeURIComponent(pathname)}`;
      router.replace(loginUrl);
      router.refresh();
    })();
  }, [pathname, router, supabase]);

  return null;
}
