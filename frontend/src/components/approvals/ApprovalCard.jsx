import { LockKeyhole, ShieldAlert } from 'lucide-react';
import { formatCurrency } from '../../utils/formatters.js';

export default function ApprovalCard({ item, busy, onApprove, onReject }) {
  if (!item?.action?.requires_approval || item.action.approval_status !== 'PENDING') return null;

  const selected = item.interventions?.find((intervention) => intervention.selected);

  return (
    <div className="reveal-up rounded-2xl border border-amber-300/20 bg-amber-300/[0.055] p-5">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-amber-300/20 bg-amber-300/10 text-amber-200">
            <ShieldAlert size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-200/75">
              <LockKeyhole size={13} /> Human approval required
            </div>
            <h3 className="mt-2 text-lg font-semibold text-white">{selected?.name}</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
              This action changes patient pricing, so the agent cannot execute it automatically.
              A manager must authorize the intervention first.
            </p>
            {selected && (
              <p className="mt-3 text-sm text-slate-300">
                Expected recovery <span className="font-semibold text-white">{formatCurrency(selected.expected_recovery)}</span>
                {' · '}Net value <span className="font-semibold text-white">{formatCurrency(selected.net_value)}</span>
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onReject}
            className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/5 disabled:opacity-50"
          >
            Reject
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onApprove}
            className="rounded-xl bg-amber-200 px-4 py-2.5 text-sm font-bold text-amber-950 transition hover:bg-amber-100 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Approve action'}
          </button>
        </div>
      </div>
    </div>
  );
}
