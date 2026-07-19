"use client";

import type {
  CategoryPresetFilter,
  DistrictFilter,
  Filters,
  PriceFilter,
  SizeFilter,
} from "@/types/property";
import {
  CATEGORY_PRESETS,
  getCategoryPreset,
} from "@/lib/category-presets";
import LocalStudentFilter from "@/components/LocalStudentFilter";
import {
  sanitizeUniversityZones,
  type UniversityZoneId,
} from "@/lib/university-zones";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type ListingsViewMode = "matched" | "all";

interface FilterBarProps {
  filters: Filters;
  onChange: (filters: Filters) => void;
  viewMode: ListingsViewMode;
  onViewModeChange: (mode: ListingsViewMode) => void;
  /** 租盤列表載入中：鎖定 Tab 避免重複請求 */
  listingsLoading: boolean;
  sortByMatch: boolean;
  onToggleSortByMatch: () => void;
}

export default function FilterBar({
  filters,
  onChange,
  viewMode,
  onViewModeChange,
  listingsLoading,
  sortByMatch,
  onToggleSortByMatch,
}: FilterBarProps) {
  const tabDisabled = listingsLoading;
  const activePreset = getCategoryPreset(filters.categoryPreset);
  const showStudentZones = filters.categoryPreset === "local_student";
  const selectedZones = sanitizeUniversityZones(filters.universityZones);

  function setCategoryPreset(next: CategoryPresetFilter) {
    const clearing = filters.categoryPreset === next;
    const nextPreset = clearing ? "" : next;
    onChange({
      ...filters,
      categoryPreset: nextPreset,
      // 離開本地學生時清空通勤圈
      universityZones: nextPreset === "local_student" ? filters.universityZones : [],
    });
  }

  function setUniversityZones(zones: UniversityZoneId[]) {
    onChange({
      ...filters,
      universityZones: zones,
    });
  }

  return (
    <div className="sticky top-[57px] z-40 border-b border-zinc-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto max-w-6xl px-4 pb-2 pt-2.5 sm:px-6">
        <div
          className={cn(
            "mb-2.5 flex w-full max-w-md rounded-lg border border-zinc-200 bg-zinc-100/80 p-0.5 sm:max-w-lg",
            tabDisabled && "pointer-events-none opacity-70"
          )}
          role="tablist"
          aria-label="租盤列表顯示模式"
        >
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "matched"}
            disabled={tabDisabled}
            onClick={() => onViewModeChange("matched")}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-center text-sm font-semibold transition-colors",
              viewMode === "matched"
                ? "bg-[#0f2540] text-white shadow-sm"
                : "text-zinc-600 hover:bg-white/80 hover:text-zinc-900",
              tabDisabled && "cursor-not-allowed"
            )}
          >
            🔥 智能配對
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "all"}
            disabled={tabDisabled}
            onClick={() => onViewModeChange("all")}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-center text-sm font-semibold transition-colors",
              viewMode === "all"
                ? "bg-[#0f2540] text-white shadow-sm"
                : "text-zinc-600 hover:bg-white/80 hover:text-zinc-900",
              tabDisabled && "cursor-not-allowed"
            )}
          >
            🌍 全部租盤
          </button>
        </div>

        <div className="mb-2.5">
          <p className="mb-1.5 text-xs font-medium tracking-wide text-zinc-500">
            客群專屬推薦
          </p>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="客群專屬推薦"
          >
            {CATEGORY_PRESETS.map((preset) => {
              const selected = filters.categoryPreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setCategoryPreset(preset.id)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                    selected
                      ? "border-[#0f2540] bg-[#0f2540] text-white shadow-sm"
                      : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          {activePreset ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-zinc-500">已套用：</span>
              {activePreset.displayTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-900"
                >
                  {tag}
                </span>
              ))}
              <button
                type="button"
                onClick={() => setCategoryPreset("")}
                className="ml-1 text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline"
              >
                清除
              </button>
            </div>
          ) : null}

          {showStudentZones ? (
            <LocalStudentFilter
              selectedZones={selectedZones}
              onChange={setUniversityZones}
            />
          ) : null}
        </div>
      </div>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2.5 px-4 pb-2.5 sm:px-6">
        <Select
          value={filters.district || "all"}
          onValueChange={(val) =>
            onChange({
              ...filters,
              district: (val === "all" ? "" : val) as DistrictFilter,
            })
          }
        >
          <SelectTrigger className="h-9 min-w-[130px] flex-1 text-sm">
            <SelectValue placeholder="地區 — 全部" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部地區</SelectItem>
            <SelectItem value="港島">港島</SelectItem>
            <SelectItem value="九龍">九龍</SelectItem>
            <SelectItem value="新界">新界</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.price || "all"}
          onValueChange={(val) =>
            onChange({ ...filters, price: (val === "all" ? "" : val) as PriceFilter })
          }
        >
          <SelectTrigger className="h-9 min-w-[160px] flex-1 text-sm">
            <SelectValue placeholder="租金 — 全部" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部租金（單房／人均）</SelectItem>
            <SelectItem value="low">HK$4,000 以下</SelectItem>
            <SelectItem value="mid">HK$4,000 - $6,000</SelectItem>
            <SelectItem value="high">HK$6,000 以上</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.size || "all"}
          onValueChange={(val) =>
            onChange({ ...filters, size: (val === "all" ? "" : val) as SizeFilter })
          }
        >
          <SelectTrigger className="h-9 min-w-[150px] flex-1 text-sm">
            <SelectValue placeholder="面積 — 全部" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部面積</SelectItem>
            <SelectItem value="small">100 呎以下</SelectItem>
            <SelectItem value="med">100 - 200 呎</SelectItem>
            <SelectItem value="large">200 呎以上</SelectItem>
          </SelectContent>
        </Select>

        {viewMode === "matched" ? (
          <button
            type="button"
            onClick={onToggleSortByMatch}
            className={`h-9 shrink-0 rounded-md border px-3 text-sm font-medium transition-colors ${
              sortByMatch
                ? "border-[#0f2540] bg-[#0f2540] text-white hover:bg-[#1a3a5c]"
                : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
            }`}
          >
            ✨ 幫我搵神仙室友
          </button>
        ) : null}
      </div>
    </div>
  );
}
