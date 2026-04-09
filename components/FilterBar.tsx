"use client";

import type {
  DistrictFilter,
  Filters,
  PriceFilter,
  SizeFilter,
} from "@/types/property";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface FilterBarProps {
  filters: Filters;
  onChange: (filters: Filters) => void;
}

export default function FilterBar({ filters, onChange }: FilterBarProps) {
  return (
    <div className="sticky top-[57px] z-40 border-b border-zinc-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2.5 px-4 py-2.5 sm:px-6">
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
            <SelectItem value="all">全部租金</SelectItem>
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
      </div>
    </div>
  );
}
