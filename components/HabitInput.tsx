"use client";

type HabitInputProps = {
  label: string;
  value: number;
  onChange: (nextValue: number) => void;
  leftText: string;
  rightText: string;
};

function clampHabitValue(raw: number): number {
  if (!Number.isFinite(raw)) return 1;
  if (raw < 1) return 1;
  if (raw > 5) return 5;
  return Math.round(raw);
}

export default function HabitInput({ label, value, onChange, leftText, rightText }: HabitInputProps) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-zinc-800">{label}</h4>
        <input
          type="number"
          min={1}
          max={5}
          value={value}
          onChange={(e) => onChange(clampHabitValue(Number(e.target.value)))}
          className="h-10 w-20 rounded-lg border border-zinc-300 px-3 text-center text-sm font-semibold text-zinc-900 outline-none ring-[#0f2540] transition focus:border-[#0f2540] focus:ring-2"
        />
      </div>

      <input
        type="range"
        min="1"
        max="5"
        step="1"
        value={value}
        onChange={(e) => onChange(clampHabitValue(Number(e.target.value)))}
        className="mt-3 w-full accent-[#0f2540]"
      />

      <div className="mt-2 flex items-center justify-between text-sm text-zinc-500">
        <span>{leftText}</span>
        <span>{rightText}</span>
      </div>
    </section>
  );
}
