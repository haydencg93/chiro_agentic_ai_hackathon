import { CheckCircle2, LockKeyhole } from 'lucide-react';
import { formatCurrency } from '../../utils/formatters.js';

export default function InterventionGrid({ interventions = [] }) {
  if (!interventions.length) return null;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {interventions.map((item) => (
        <div
          key={item.intervention_id}
          className={`reveal-up rounded-2xl border p-5 ${item.selected ? 'border-emerald-300/25 bg-emerald-300/[0.06] shadow-[0_0_30px_rgba(16,185,129,.05)]' : 'border-white/8 bg-white/[0.022]'}`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-slate-100">{item.name}</h3>
                {item.selected && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
                    <CheckCircle2 size={12} /> Selected
                  </span>
                )}
                {item.requires_approval && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/15 bg-amber-300/[0.07] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-200">
                    <LockKeyhole size={11} /> Approval
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-500">{item.description}</p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-white/7 pt-4">
            <Metric label="Recovery" value={formatCurrency(item.expected_recovery)} />
            <Metric label="Cost" value={formatCurrency(item.estimated_cost)} />
            <Metric label="Net value" value={formatCurrency(item.net_value)} strong={item.selected} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value, strong = false }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-600">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${strong ? 'text-emerald-200' : 'text-slate-300'}`}>{value}</p>
    </div>
  );
}
