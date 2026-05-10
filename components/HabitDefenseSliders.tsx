"use client";

import { useState } from "react";

export type HabitDimensionKey =
  | "habit_cleanliness"
  | "habit_ac_temp"
  | "habit_guests"
  | "habit_noise";

export type HabitValues = Record<HabitDimensionKey, number>;

type HabitDefenseSlidersProps = {
  values: HabitValues;
  onChange: (key: HabitDimensionKey, value: number) => void;
};

const HABIT_SLIDER_ITEMS: Array<{
  key: HabitDimensionKey;
  title: string;
  scaleNotes: {
    low: string;
    mid: string;
    high: string;
  };
}> = [
  {
    key: "habit_cleanliness",
    title: "洗碗與公共衛生極限",
    scaleNotes: {
      low: "【零容忍】用完廚房/浴室 10 分鐘內必須清空恢復原狀。",
      mid: "【不過夜】允許短暫放置，但睡前必須清理完畢。",
      high: "【極度隨性】習慣累積到週末或等管家清潔，不介意雜亂。",
    },
  },
  {
    key: "habit_ac_temp",
    title: "冷氣使用與溫度偏好",
    scaleNotes: {
      low: "【北極熊】20度以下，人在客廳/房間 24 小時長開。",
      mid: "【標準睡眠】23-25度，僅夜間睡覺時開啟。",
      high: "【環保節能】極少開冷氣，以風扇為主，對電費敏感。",
    },
  },
  {
    key: "habit_guests",
    title: "訪客與邊界政策",
    scaleNotes: {
      low: "【絕對私密】禁止任何非合租室友進入單位。",
      mid: "【有限開放】每月 1-2 次訪客，需提前 24 小時報備，禁過夜。",
      high: "【無界社交】隨時歡迎帶朋友回來，當成自己獨居的家。",
    },
  },
  {
    key: "habit_noise",
    title: "靜音時段嚴格度",
    scaleNotes: {
      low: "【神經衰弱】23:00 後絕對靜音（禁洗衣機、講電話需氣音）。",
      mid: "【標準作息】24:00 後關房門戴耳機，接受微弱生活白噪音。",
      high: "【無感夜貓】無懼噪音，接受半夜煮宵夜或外放音頻。",
    },
  },
];

function clampHabitValue(value: unknown): number {
  const n = Number(value);
  const base = Number.isFinite(n) ? n : 3;
  return Math.min(5, Math.max(1, Math.round(base)));
}

export default function HabitDefenseSliders({ values, onChange }: HabitDefenseSlidersProps) {
  const [inputDraft, setInputDraft] = useState<Partial<Record<HabitDimensionKey, string>>>({});

  const getDisplayValue = (key: HabitDimensionKey): string =>
    inputDraft[key] !== undefined ? inputDraft[key]! : String(values[key]);

  const commitValue = (key: HabitDimensionKey, next: unknown) => {
    onChange(key, clampHabitValue(next));
    setInputDraft((prev) => {
      const updated = { ...prev };
      delete updated[key];
      return updated;
    });
  };

  return (
    <div className="mt-3 space-y-4">
      {HABIT_SLIDER_ITEMS.map((item) => (
        <div key={item.key} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-[#0f2540]">{item.title}</h4>
            <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-600">
              <span className="hidden sm:inline">分數 (1-5)</span>
              <input
                type="number"
                min={1}
                max={5}
                step={1}
                inputMode="numeric"
                autoComplete="off"
                value={getDisplayValue(item.key)}
                onChange={(e) => {
                  const raw = e.target.value;
                  setInputDraft((prev) => ({ ...prev, [item.key]: raw }));
                  const trimmed = raw.trim();
                  if (trimmed === "") return;
                  const parsed = Number(trimmed);
                  const rounded = Math.round(parsed);
                  if (Number.isFinite(parsed) && rounded >= 1 && rounded <= 5 && Math.abs(parsed - rounded) < 1e-9) {
                    commitValue(item.key, rounded);
                  }
                }}
                onBlur={() => {
                  const raw = inputDraft[item.key];
                  if (raw === undefined) return;
                  const trimmed = raw.trim();
                  if (trimmed === "") {
                    commitValue(item.key, values[item.key]);
                    return;
                  }
                  const parsed = Number(trimmed);
                  const rounded = Math.round(parsed);
                  if (!Number.isFinite(parsed) || rounded < 1 || rounded > 5) {
                    commitValue(item.key, values[item.key]);
                    return;
                  }
                  commitValue(item.key, rounded);
                }}
                className="w-16 px-2 py-1 text-center border border-gray-300 rounded-md focus:ring-2 focus:ring-[#0f2540] outline-none"
                aria-label={`${item.title} 分數`}
              />
            </label>
          </div>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={clampHabitValue(values[item.key])}
            onChange={(event) => commitValue(item.key, Number(event.target.value))}
            className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-zinc-200 accent-[#0f2540]"
            aria-label={item.title}
          />
          <div className="mt-3 grid gap-2 text-xs leading-relaxed text-zinc-600">
            <p className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1">
              <span className="font-semibold text-zinc-800">1：</span>
              {item.scaleNotes.low}
            </p>
            <p className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1">
              <span className="font-semibold text-zinc-800">3：</span>
              {item.scaleNotes.mid}
            </p>
            <p className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1">
              <span className="font-semibold text-zinc-800">5：</span>
              {item.scaleNotes.high}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
