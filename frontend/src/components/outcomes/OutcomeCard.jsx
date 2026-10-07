import { CircleCheckBig, TrendingUp } from 'lucide-react';
import { formatCurrency } from '../../utils/formatters.js';

export default function OutcomeCard({ outcome }) {
  if (!outcome) return null;

  return (
    <div className="reveal-up overflow-hidden rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.055]">
      <div className="flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-emerald-300/12 text-emerald-200">
            <CircleCheckBig size={23} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200/70">Rescue successful</p>
            <h3 className="mt-2 text-xl font-semibold text-white">Patient re-engaged</h3>
            <p className="mt-2 text-sm text-slate-400">{outcome.detail}</p>
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-300/15 bg-black/10 px-6 py-4 md:text-right">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-emerald-200/65 md:justify-end">
            <TrendingUp size={14} /> Revenue recovered
          </div>
          <div className="mt-2 text-3xl font-semibold text-emerald-100">{formatCurrency(outcome.revenue_recovered)}</div>
        </div>
      </div>
    </div>
  );
}
