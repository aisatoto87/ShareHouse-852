"use client";

import { useEffect, useState } from "react";

/** 元件是否已在瀏覽器掛載（避免 SSR / Client 時區或 locale 不一致造成 hydration 錯誤） */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted;
}
