import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '../../utils/formatters.js';
import { RiskBadge, StatusBadge } from '../ui/Badges.jsx';

export default function CaseTable({ cases }) {
  const navigate = useNavigate();

  return (
    <div className="overflow-hidden rounded-3xl border border-white/8 bg-[var(--surface)] shadow-[0_16px_40px_rgba(0,0,0,.22)]">
      <div className="hidden grid-cols-[1.1fr_.9fr_.85fr_1fr_.9fr_36px] gap-4 border-b border-white/8 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)] lg:grid">
        <span>Patient ID</span>
        <span>Risk</span>
        <span>At Risk</span>
        <span>Issue</span>
        <span>Status</span>
        <span />
      </div>

      <div className="divide-y divide-white/7">
        {cases.map((item) => (
          <button
            key={item.case_id}
            type="button"
            onClick={() => navigate(`/cases/${encodeURIComponent(item.case_id)}`)}
            className="grid w-full grid-cols-1 gap-3 px-5 py-4 text-left transition hover:bg-white/[0.03] lg:grid-cols-[1.1fr_.9fr_.85fr_1fr_.9fr_36px] lg:items-center lg:gap-4"
          >
            <div className="min-w-0">
              <div className="wrap-anywhere font-semibold text-white">{item.patient.patient_id}</div>
            </div>
            <div><RiskBadge level={item.risk.level} /></div>
            <div className="wrap-anywhere font-medium text-[var(--text-primary)]">{formatCurrency(item.risk.revenue_at_risk)}</div>
            <div className="min-w-0">
              <div className="wrap-anywhere text-sm font-medium text-[var(--text-primary)]">{item.status === 'READY' ? 'Observed risk signals' : item.issue}</div>
              <div className="wrap-anywhere mt-0.5 text-xs text-[var(--text-muted)]">Snapshot {item.as_of_date || '—'}</div>
            </div>
            <div><StatusBadge status={item.status} /></div>
            <ChevronRight size={18} className="hidden text-[var(--text-muted)] lg:block" />
          </button>
        ))}
      </div>
    </div>
  );
}
