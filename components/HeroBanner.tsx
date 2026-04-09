import { CheckCircle, Shield, Users } from "lucide-react";

const pills = [
  { icon: Users, label: "專業室友配對" },
  { icon: Shield, label: "代為業主交涉" },
  { icon: CheckCircle, label: "全程跟進入住" },
];

export default function HeroBanner() {
  return (
    <section className="relative overflow-hidden bg-[#0f2540] px-4 py-10 sm:px-6 sm:py-14">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(-45deg, #fff 0px, #fff 1px, transparent 1px, transparent 40px)",
        }}
      />

      <div className="relative mx-auto max-w-6xl">
        <div className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-[#7eb8f7]">
          <span className="inline-block h-px w-5 bg-[#7eb8f7]" />
          合租管家服務
          <span className="inline-block h-px w-5 bg-[#7eb8f7]" />
        </div>

        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-[#f0f6ff] sm:text-4xl">
          你揀樓，
          <em className="not-italic text-[#7eb8f7]">我哋幫你配對室友</em>
        </h1>

        <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#8aaac8] sm:text-base">
          一站式合租管家服務，免卻與業主交涉煩惱，輕鬆入住理想空間。
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          {pills.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-1.5 rounded-full border border-[#7eb8f7]/25 px-3 py-1.5 text-xs text-[#7eb8f7]"
            >
              <Icon className="h-3 w-3 shrink-0" />
              {label}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
