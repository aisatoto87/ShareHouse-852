"use client";

import { useCallback, useEffect, useState } from "react";
import { getAdminPendingCounts } from "@/app/actions/adminStatsActions";

const POLL_INTERVAL_MS = 45_000;

type AdminPendingCountsState = {
  inbox_unread_count: number;
  moderation_total_count: number;
  loading: boolean;
  refresh: () => Promise<void>;
};

export function useAdminPendingCounts(enabled = true): AdminPendingCountsState {
  const [counts, setCounts] = useState({
    inbox_unread_count: 0,
    moderation_total_count: 0,
  });
  const [loading, setLoading] = useState(enabled);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setCounts({ inbox_unread_count: 0, moderation_total_count: 0 });
      setLoading(false);
      return;
    }

    const result = await getAdminPendingCounts();
    if (result.success) {
      setCounts({
        inbox_unread_count: result.inbox_unread_count,
        moderation_total_count: result.moderation_total_count,
      });
    }
    setLoading(false);
  }, [enabled]);

  useEffect(() => {
    setLoading(enabled);
    void refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return;

    const interval = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    const onFocus = () => {
      void refresh();
    };

    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, refresh]);

  return {
    ...counts,
    loading,
    refresh,
  };
}
