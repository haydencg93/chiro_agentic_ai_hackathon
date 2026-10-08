import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, CheckCircle2, CircleDollarSign,
  Clock3, Filter, MoveUpRight, ShieldAlert, Sparkles, UsersRound, X,
} from 'lucide-react';
import { agentApi } from '../api/agentApi.js';
import CaseTable from '../components/dashboard/CaseTable.jsx';
import MetricCard from '../components/ui/MetricCard.jsx';
import { APP_NAME } from '../config.js';
import { formatCurrency } from '../utils/formatters.js';

export default function DashboardPage() {
  const [summary, setSummary] = useState(null);
  const [cases, setCases] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('AT_RISK');
  const [showCommandCenter, setShowCommandCenter] = useState(true);

  useEffect(() => {
    let active = true;

    Promise.all([agentApi.getSummary(), agentApi.getCases()])
      .then(([summaryData, caseData]) => {
        if (!active) return;
        setSummary(summaryData);
        setCases(caseData?.cases ?? []);
      })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, []);

  const filteredCases = useMemo(
    () => filterCases(cases, activeFilter),
    [cases, activeFilter],
  );

  function notify(message, type = 'success') {
    window.dispatchEvent(new CustomEvent('app:notice', { detail: { message, type } }));
  }

  function applyFilter(filter) {
    try {
      const allowed = ['AT_RISK', 'NEED_APPROVAL', 'CASES', 'RECOVERED'];
      if (!allowed.includes(filter)) throw new Error('Unknown queue filter.');

      const matches = filterCases(cases, filter);
      setActiveFilter(filter);
      notify(
        `Priority queue filtered to ${filterLabel(filter)} — ${matches.length} ${matches.length === 1 ? 'match' : 'matches'}.`,
      );
    } catch (filterError) {
      notify(`Could not filter the priority queue: ${filterError.message}`, 'error');
    }
  }

  if (loading) return <DashboardSkeleton />;

  if (error) {
    return (
      <div role="alert" className="surface-card rounded-[28px] p-6">
        <p className="wrap-anywhere font-semibold text-[#ffc7d2]">Could not load the dashboard.</p>
        <p className="wrap-anywhere mt-2 text-sm text-[var(--text-secondary)]">{error}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-6 max-md:grid-cols-1">
      {showCommandCenter ? (
        <section aria-label="Executive Command Center" className="surface-card relative col-span-3 rounded-[32px] p-6 lg:p-7 max-md:col-span-1">
          <button
            type="button"
            aria-label="Close Executive Command Center"
            onClick={() => setShowCommandCenter(false)}
            className="absolute right-5 top-5 grid size-10 place-items-center rounded-xl border border-white/8 bg-white/[0.03] text-[var(--text-secondary)] transition hover:bg-white/[0.08] hover:text-white"
          >
            <X size={18} />
          </button>
          <div className="flex min-w-0 items-end justify-between gap-4 pr-12 max-[900px]:flex-col max-[900px]:items-start">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ice-blue)]/80">
                <Sparkles size={14} className="shrink-0" />
                <span className="wrap-anywhere">Executive Command Center</span>
              </div>
              <h1 className="wrap-anywhere mt-3 text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
                Agent-guided recovery for at-risk patient revenue.
              </h1>
              <p className="wrap-anywhere mt-3 max-w-3xl text-base leading-7 text-[var(--text-secondary)]">
                {APP_NAME} identifies revenue at risk, tracks agent actions, surfaces priority cases,
                and keeps teams focused on the business outcomes that matter most.
              </p>
            </div>
            <div className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-[rgba(140,231,255,.16)] bg-[rgba(140,231,255,.06)] px-4 py-3 text-sm text-[var(--ice-blue)]">
              <span className="size-2 shrink-0 rounded-full bg-[var(--ice-blue)] shadow-[0_0_18px_rgba(140,231,255,.7)]" />
              <span className="wrap-anywhere">AI workflow active</span>
            </div>
          </div>
        </section>
      ) : null}

      <section className="col-span-3 grid grid-cols-3 gap-4 max-md:col-span-1 max-md:grid-cols-1">
        <MetricCard label="At Risk" value={formatCurrency(summary.revenue_at_risk)} hint={`${summary.high_risk_cases} high-risk cases`} icon={AlertTriangle} accent="rose" active={activeFilter === 'AT_RISK'} onClick={() => applyFilter('AT_RISK')} />
        <MetricCard label="Need Approval" value={String(summary.awaiting_approval ?? 0)} hint="Actions waiting on supervisor review" icon={ShieldAlert} accent="violet" active={activeFilter === 'NEED_APPROVAL'} onClick={() => applyFilter('NEED_APPROVAL')} />
        <MetricCard label="Cases" value={String(summary.cases_detected ?? 0)} hint={`${cases.length} shown in current queue`} icon={UsersRound} accent="indigo" active={activeFilter === 'CASES'} onClick={() => applyFilter('CASES')} />
        <MetricCard label="Recovered" value={formatCurrency(summary.revenue_recovered)} hint="Simulated measured outcomes" icon={CheckCircle2} accent="emerald" active={activeFilter === 'RECOVERED'} onClick={() => applyFilter('RECOVERED')} />
        <MetricCard label="Potentially Recoverable" value={formatCurrency(summary.potentially_recoverable)} hint="Modeled recovery opportunity" icon={CircleDollarSign} accent="ice" />
        <MetricCard label="Actions Executed" value={String(summary.actions_executed ?? 0)} hint="Agent-approved actions completed" icon={Activity} accent="indigo" />
      </section>

      {/* Priority work comes first so operators can act before reviewing trends. */}
      <div className="col-span-3 max-md:col-span-1">
        <div className="surface-card rounded-[32px] p-5 lg:p-6">
          <div className="mb-5 flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="wrap-anywhere text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Priority queue</p>
              <h2 className="wrap-anywhere mt-1 text-2xl font-semibold text-white">Priority Cases</h2>
            </div>
            <div className="inline-flex min-w-0 items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs text-[var(--text-secondary)]">
              <Filter size={13} className="shrink-0" />
              <span className="wrap-anywhere">Showing {filterLabel(activeFilter)}</span>
            </div>
          </div>
          <CaseTable cases={filteredCases} />
        </div>
      </div>

      <div className="col-span-2 max-md:col-span-1">
        <RevenueTrendCard summary={summary} />
      </div>

      <div>
        <AgentActivityCard activities={summary.agent_activity} />
      </div>
    </div>
  );
}

function filterCases(cases, filter) {
  if (filter === 'NEED_APPROVAL') return cases.filter((item) => item.status === 'AWAITING_APPROVAL');
  if (filter === 'RECOVERED') return cases.filter((item) => item.status === 'RESCUED');
  if (filter === 'CASES') return cases;
  return [...cases].sort((a, b) => b.risk.revenue_at_risk - a.risk.revenue_at_risk);
}

function RevenueTrendCard({ summary }) {
  const values = summary.revenue_series || [];
  const labels = summary.revenue_labels || [];
  const max = Math.max(...values, 1);
  const width = 520;
  const height = 150;
  const step = width / Math.max(values.length, 1);
  const xPosition = (index) => (index + 0.5) * step;
  const points = values
    .map((value, index) => {
      const x = xPosition(index);
      const y = height - (value / max) * (height - 20) - 10;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className="surface-card rounded-[32px] p-5 lg:p-6">
      <div className="mb-6 flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="wrap-anywhere text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Recovered revenue</p>
          <div className="mt-2 flex min-w-0 flex-wrap items-end gap-3">
            <div className="wrap-anywhere text-4xl font-semibold tracking-tight text-white">{formatCurrency(summary.revenue_recovered)}</div>
            {Number.isFinite(summary.recovery_change_pct) ? (
              <div className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#77e9b2]/20 bg-[#77e9b2]/10 px-2.5 py-1 text-xs font-semibold text-[#b8ffd9]">
                <MoveUpRight size={12} /> {summary.recovery_change_pct > 0 ? '+' : ''}{summary.recovery_change_pct}%
              </div>
            ) : null}
          </div>
          {Number.isFinite(summary.recovery_change_pct) ? (
            <p className="wrap-anywhere mt-2 text-sm text-[var(--text-secondary)]">vs. previous 30 days</p>
          ) : null}
        </div>
        <div className="shrink-0 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs text-[var(--text-secondary)]">Last 30 days</div>
      </div>

      <div className="rounded-[28px] border border-white/7 bg-[var(--surface-elevated)] p-4">
        <div className="flex h-[220px] flex-col overflow-hidden rounded-2xl" role="img" aria-label={`Recovered revenue trend over the last 30 days, ${values.length} data points`}>
          <div className="relative min-h-0 flex-1">
            <div aria-hidden="true" className="absolute inset-0 grid grid-cols-6 grid-rows-4 gap-0 opacity-30">
              {Array.from({ length: 24 }).map((_, index) => <div key={index} className="border border-white/[0.035]" />)}
            </div>

            <div
              data-testid="trend-bars"
              className="absolute inset-0 grid items-end gap-2"
              style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}
            >
              {values.map((value, index) => (
                <div key={index} className="flex h-full items-end">
                  <div className="w-full rounded-t-xl bg-[linear-gradient(180deg,rgba(140,231,255,.55),rgba(86,87,232,.35))]" style={{ height: `${Math.max(18, (value / max) * 160)}px` }} />
                </div>
              ))}
            </div>

            <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none" aria-hidden="true">
              <polyline fill="none" stroke="rgba(140,231,255,.95)" strokeWidth="3" points={points} />
              {values.map((value, index) => {
                const x = xPosition(index);
                const y = height - (value / max) * (height - 20) - 10;
                return <circle key={index} cx={x} cy={y} r="4" fill="rgba(140,231,255,.95)" />;
              })}
            </svg>
          </div>

          {labels.length && values.length ? (
            <div
              data-testid="trend-date-labels"
              className="grid h-6 shrink-0 items-center gap-2 text-[10px] text-[var(--text-muted)]"
              style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}
            >
              {labels.slice(0, values.length).map((label, index) => <span key={`${label}-${index}`} className="wrap-anywhere min-w-0 text-center">{label}</span>)}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AgentActivityCard({ activities = [] }) {
  const [showAll, setShowAll] = useState(false);
  const visibleActivities = showAll ? activities : activities.slice(0, 3);

  return (
    <div className="surface-card rounded-[32px] p-5 lg:p-6">
      <div className="mb-5 flex min-w-0 items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="wrap-anywhere text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Agent Activity</p>
          <h2 className="wrap-anywhere mt-1 text-2xl font-semibold text-white">Live Activity</h2>
        </div>
        <div className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[#77e9b2]/16 bg-[#77e9b2]/8 px-3 py-1 text-xs text-[#b8ffd9]">
          <span className="size-2 rounded-full bg-[#77e9b2]" /> Live
        </div>
      </div>

      <div className="space-y-4">
        {visibleActivities.map((item, index) => (
          <div key={`${item.title}-${item.time}-${index}`} className="flex min-w-0 gap-4 rounded-2xl border border-white/8 bg-white/[0.02] p-4">
            <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-[rgba(140,231,255,.1)] text-[var(--ice-blue)]"><Clock3 size={16} /></div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="wrap-anywhere font-medium text-white">{item.title}</div>
                  <div className="wrap-anywhere mt-1 text-sm leading-6 text-[var(--text-secondary)]">{item.detail}</div>
                </div>
                <div className="shrink-0 text-xs text-[var(--text-muted)]">{item.time}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {activities.length > 3 ? (
        <button type="button" aria-expanded={showAll} onClick={() => setShowAll((current) => !current)} className="mt-4 w-full rounded-2xl border border-white/8 bg-white/[0.025] px-4 py-3 text-sm font-semibold text-[var(--ice-blue)] transition hover:bg-white/[0.05]">
          {showAll ? 'Show Less' : `Show More (${activities.length - 3})`}
        </button>
      ) : null}
    </div>
  );
}

function filterLabel(value) {
  const map = {
    AT_RISK: 'at-risk cases',
    NEED_APPROVAL: 'approval-required cases',
    CASES: 'all active cases',
    RECOVERED: 'rescued cases',
  };
  return map[value] || 'priority cases';
}

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-3 animate-pulse gap-6 max-md:grid-cols-1">
      <div className="col-span-3 h-36 rounded-[32px] bg-white/[0.035] max-md:col-span-1" />
      <div className="col-span-3 grid grid-cols-3 gap-4 max-md:col-span-1 max-md:grid-cols-1">
        {[1, 2, 3, 4, 5, 6].map((item) => <div key={item} className="h-36 rounded-[28px] bg-white/[0.035]" />)}
      </div>
      <div className="col-span-3 h-[420px] rounded-[32px] bg-white/[0.035] max-md:col-span-1" />
      <div className="col-span-2 h-[360px] rounded-[32px] bg-white/[0.035] max-md:col-span-1" />
      <div className="h-[360px] rounded-[32px] bg-white/[0.035]" />
    </div>
  );
}
