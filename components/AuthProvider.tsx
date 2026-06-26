"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  createSupabaseBrowserClient,
  getBrowserUser,
} from "@/lib/supabase/client";

type AuthContextValue = {
  /** Current authenticated user, or null when signed out / still loading. */
  user: User | null;
  /** True until the initial auth probe resolves. */
  loading: boolean;
  /** Shared singleton browser client, so children never create their own. */
  supabase: SupabaseClient;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Single source of truth for client-side auth. Calls getUser() ONCE and listens
 * to a single onAuthStateChange subscription, then broadcasts the user down the
 * tree via context. This avoids dozens of leaf components (heart buttons, admin
 * cards, etc.) each hammering supabase.auth.getUser() and fighting over the
 * navigator.locks lock — the root cause of the "Lock broken by another request"
 * AbortError spam.
 */
export default function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void (async () => {
      const { user: initialUser } = await getBrowserUser(supabase);
      if (!active) return;
      setUser(initialUser);
      setLoading(false);
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, supabase }),
    [user, loading, supabase]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Read the shared auth state. Leaf components should use this instead of calling
 * supabase.auth.getUser() in their own effects.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an <AuthProvider>");
  }
  return ctx;
}
