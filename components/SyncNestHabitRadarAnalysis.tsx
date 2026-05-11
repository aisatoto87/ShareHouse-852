"use client";

import { useMemo } from "react";
import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

export type HabitRadarValues = {
  cleanliness: number;
  acTemp: number;
  guests: number;
  noise: number;
};

const DIMENSIONS: { key: keyof HabitRadarValues; label: string; compliment: string }[] = [
  {
    key: "cleanliness",
    label: "衛生容忍度 (v1)",
    compliment: "你們對環境潔淨的標準幾乎同步，共用空間有望很舒心！",
  },
  {
    key: "acTemp",
    label: "冷氣偏好 (v2)",
    compliment: "你們都是節能北極熊，電費分擔無難度！",
  },
  {
    key: "guests",
    label: "訪客政策 (v3)",
    compliment: "訪客尺度相近，客廳熱鬧與安靜的平衡拿捏得到！",
  },
  {
    key: "noise",
    label: "作息規律 (v4)",
    compliment: "作息節奏高度合拍，晚安互相不打擾！",
  },
];

function pickCompliment(you: HabitRadarValues, listing: HabitRadarValues): string {
  let bestKey: keyof HabitRadarValues = "cleanliness";
  let bestDiff = Infinity;
  for (const { key } of DIMENSIONS) {
    const diff = Math.abs(you[key] - listing[key]);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestKey = key;
    }
  }
  const row = DIMENSIONS.find((d) => d.key === bestKey);
  return row?.compliment ?? "生活習慣輪廓相近，值得約一次線上看屋聊聊！";
}

interface SyncNestHabitRadarAnalysisProps {
  you: HabitRadarValues;
  listing: HabitRadarValues;
  viewerLoggedIn: boolean;
}

export default function SyncNestHabitRadarAnalysis({
  you,
  listing,
  viewerLoggedIn,
}: SyncNestHabitRadarAnalysisProps) {
  const chartData = useMemo(
    () =>
      DIMENSIONS.map(({ key, label }) => ({
        subject: label,
        你: you[key],
        此租盤: listing[key],
      })),
    [you, listing]
  );

  const compliment = useMemo(() => pickCompliment(you, listing), [you, listing]);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-1 border-b border-zinc-100 pb-4">
        <h2 className="text-lg font-semibold text-zinc-900">SyncNest 智能契合度分析</h2>
        <p className="text-sm text-zinc-500">
          雷達圖比對「你」與「此租盤」四維生活習慣（0–5 分）；數值愈接近，該維度愈合拍。
        </p>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,280px)] lg:items-center">
        <div className="relative mx-auto w-full min-h-[300px] max-w-lg lg:max-w-none">
          <ResponsiveContainer width="100%" height={320}>
            <RadarChart cx="50%" cy="50%" outerRadius="75%" data={chartData}>
              <PolarGrid stroke="#e4e4e7" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: "#52525b", fontSize: 11 }} />
              <PolarRadiusAxis
                angle={30}
                domain={[0, 5]}
                tickCount={6}
                tick={{ fill: "#a1a1aa", fontSize: 10 }}
              />
              <Radar
                name="你"
                dataKey="你"
                stroke="#1d4ed8"
                strokeWidth={2}
                fill="#3b82f6"
                fillOpacity={0.35}
              />
              <Radar
                name="此租盤"
                dataKey="此租盤"
                stroke="#047857"
                strokeWidth={2}
                fill="#10b981"
                fillOpacity={0.28}
              />
              <Legend
                wrapperStyle={{ paddingTop: 12 }}
                formatter={(value) => <span className="text-sm text-zinc-700">{value}</span>}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid #e4e4e7",
                  fontSize: 13,
                }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <aside className="flex flex-col justify-center rounded-xl bg-gradient-to-br from-[#0f2540]/[0.06] to-sky-50/80 p-5 ring-1 ring-[#0f2540]/10">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#0f2540]/70">
            SyncNest 智能分析報告
          </p>
          <p className="mt-3 text-base font-medium leading-relaxed text-zinc-800">{compliment}</p>
          {!viewerLoggedIn ? (
            <p className="mt-4 text-xs leading-relaxed text-zinc-500">
              你尚未登入：圖中「你」暫以預設習慣（各項 3）顯示；登入並填寫問卷後會更準確。
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
