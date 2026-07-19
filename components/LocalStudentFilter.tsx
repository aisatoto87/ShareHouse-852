"use client";

import {
  UNIVERSITY_ZONE_GROUPS,
  type UniversityZoneId,
} from "@/lib/university-zones";
import { cn } from "@/lib/utils";

type LocalStudentFilterProps = {
  selectedZones: UniversityZoneId[];
  onChange: (zones: UniversityZoneId[]) => void;
};

export default function LocalStudentFilter({
  selectedZones,
  onChange,
}: LocalStudentFilterProps) {
  const selected = new Set(selectedZones);

  function toggleZone(id: UniversityZoneId) {
    if (selected.has(id)) {
      onChange(selectedZones.filter((z) => z !== id));
      return;
    }
    onChange([...selectedZones, id]);
  }

  return (
    <div
      className="mt-2.5 rounded-lg border border-amber-200/80 bg-amber-50/60 px-3 py-2.5"
      role="group"
      aria-label="大學通勤圈"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide text-amber-950">
          大學通勤圈
        </p>
        {selectedZones.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs font-medium text-amber-800/80 underline-offset-2 hover:text-amber-950 hover:underline"
          >
            清除院校
          </button>
        ) : (
          <span className="text-[11px] text-amber-800/70">可多選；未選則不限院校</span>
        )}
      </div>

      <div className="space-y-2.5">
        {UNIVERSITY_ZONE_GROUPS.map((group) => (
          <div key={group.id}>
            <p className="mb-1 text-[11px] font-medium text-amber-900/80">
              {group.title}
              <span className="ml-1 font-normal text-amber-800/60">
                （{group.subtitle}）
              </span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {group.zones.map((zone) => {
                const active = selected.has(zone.id);
                return (
                  <button
                    key={zone.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleZone(zone.id)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                      active
                        ? "border-amber-800 bg-amber-900 text-white shadow-sm"
                        : "border-amber-200/90 bg-white text-amber-950 hover:border-amber-300 hover:bg-amber-50"
                    )}
                  >
                    {zone.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
