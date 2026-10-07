import { CalendarX2, ChartNoAxesColumnDecreasing, Clock3, TriangleAlert } from 'lucide-react';

const icons = [ChartNoAxesColumnDecreasing, CalendarX2, Clock3, TriangleAlert];

export default function SignalGrid({ signals = [] }) {
  return (
    <div className="grid grid-cols-4 gap-3 max-[767px]:grid-cols-2 max-[520px]:grid-cols-1">
      {signals.map((signal, index) => {
        const Icon = icons[index % icons.length];
        return (
          <div key={`${signal.type}-${index}`} className="rounded-2xl border border-white/8 bg-white/[0.025] p-4">
            <div className="grid size-9 place-items-center rounded-lg bg-rose-300/[0.08] text-rose-200">
              <Icon size={17} />
            </div>
            <p className="mt-4 text-sm font-medium leading-6 text-slate-200">{signal.label}</p>
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">{signal.severity} signal</p>
          </div>
        );
      })}
    </div>
  );
}
