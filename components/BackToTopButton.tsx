"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

type BackToTopButtonProps = {
  className?: string;
};

export default function BackToTopButton({ className }: BackToTopButtonProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setVisible(window.scrollY > 300);
    }
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={cn(
        "inline-flex size-14 items-center justify-center rounded-full bg-[#0f2540] text-white shadow-lg transition-all hover:scale-105 hover:bg-[#1a3a5c] hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f2540] focus-visible:ring-offset-2",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
        className
      )}
      aria-label="回到頂部"
    >
      <ArrowUp className="size-7" />
    </button>
  );
}
