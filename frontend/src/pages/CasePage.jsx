import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Bot, CalendarDays, CheckCircle2,
  CircleDollarSign, ClipboardList, Play, RotateCcw, UserRound,
} from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { agentApi } from '../api/agentApi.js';
import { RiskBadge, StatusBadge } from '../components/ui/Badges.jsx';
import { formatCurrency, formatPercent } from '../utils/formatters.js';

const stageOrder = ['OBSERVE', 'INVESTIGATE', 'DIAGNOSE', 'SIMULATE', 'DECIDE', 'ACT', 'MEASURE'];
const stageLabels = {
  OBSERVE: 'Observe',
  INVESTIGATE: 'Investigate',
  DIAGNOSE: 'Diagnose',
  SIMULATE: 'Simulate',
  DECIDE: 'Decide',
  ACT: 'Act',
  MEASURE: 'Measure',
};

// Remount per case so every piece of state resets when the route param changes.
export default function CasePage() {
  const { caseId } = useParams();
  return <CaseView key={caseId} caseId={caseId} />;
}

function CaseView({ caseId }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [caseData, setCaseData] = useState(null);
  const [agentResult, setAgentResult] = useState(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const timerRef = useRef(null);
  const autoRunConsumedRef = useRef(false);
  const runAgentRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    agentApi
      .getCase(caseId)
      .then((data) => {
        if (cancelled) return;
        setCaseData(data);
        setAgentResult(null);
        setVisibleCount(data.trace?.length || 0);
        setError('');
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      window.clearInterval(timerRef.current);
    };
  }, [caseId, reloadToken]);

  function retryLoad() {
    setError('');
    setLoading(true);
    setReloadToken((token) => token + 1);
  }

  const visibleTrace = useMemo(() => {
    const source = agentResult?.trace || caseData?.trace || [];
    return source.slice(0, visibleCount);
  }, [agentResult, caseData, visibleCount]);

  const visibleStages = useMemo(() => new Set(visibleTrace.map((event) => event.stage)), [visibleTrace]);
  const resultForSections = agentResult || caseData;
  const selectedIntervention = resultForSections?.interventions?.find((item) => item.selected);

  function notify(message, type = 'success') {
    window.dispatchEvent(new CustomEvent('app:notice', { detail: { message, type } }));
  }

  function animateCaseResult(result, startCount = 0, completionMessage = '') {
    window.clearInterval(timerRef.current);
    setAgentResult(result);
    setVisibleCount(startCount);
    setRunning(true);

    if (!result.trace?.length || startCount >= result.trace.length) {
      setCaseData(result);
      setAgentResult(null);
      setVisibleCount(result.trace?.length || 0);
      setRunning(false);
      if (completionMessage) notify(completionMessage);
      return;
    }

    let count = startCount;
    timerRef.current = window.setInterval(() => {
      count += 1;
      setVisibleCount(count);

      if (count >= result.trace.length) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
        setCaseData(result);
        setAgentResult(null);
        setRunning(false);
        if (completionMessage) notify(completionMessage);
      }
    }, 650);
  }

  async function runAgent() {
    if (running || approvalBusy || !caseData) return;

    if (caseData.status === 'AWAITING_APPROVAL') {
      document.getElementById('approval-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      notify('This workflow is paused for human approval. Approve or reject the pending action to continue.', 'info');
      return;
    }

    if (caseData.status === 'RESCUED') {
      notify('This case has already completed through Measure. Refresh the case to review the final result.', 'info');
      return;
    }

    if (caseData.status === 'REVIEW') {
      notify('This case is in manual review and is not currently eligible for an automatic run.', 'info');
      return;
    }

    const startCount = caseData.status === 'ACTIONED' ? (caseData.trace?.length || 0) : 0;
    setRunning(true);
    setError('');
    setVisibleCount(startCount);
    notify(caseData.status === 'ACTIONED' ? 'Continuing the agent from the next unfinished stage…' : 'Agent run started…', 'info');

    try {
      const response = await agentApi.runCase(caseId);
      const result = response.case || response;
      animateCaseResult(result, startCount, 'Agent workflow completed.');
    } catch (err) {
      setRunning(false);
      setError(err.message);
      notify(`Agent run failed: ${err.message}`, 'error');
    }
  }

  async function handleApproval(kind) {
    if (approvalBusy || running) return;

    const previousTraceCount = caseData?.trace?.length || 0;
    setApprovalBusy(true);
    setError('');

    try {
      const response = kind === 'approve'
        ? await agentApi.approveCase(caseId)
        : await agentApi.rejectCase(caseId);
      const updated = response.case || response;

      setApprovalBusy(false);
      animateCaseResult(
        updated,
        previousTraceCount,
        kind === 'approve'
          ? 'Approval recorded. The agent continued through Measure.'
          : 'Rejection recorded. The agent re-simulated a safe alternative and continued through Measure.',
      );
    } catch (err) {
      setApprovalBusy(false);
      setError(err.message);
      notify(`Approval action failed: ${err.message}`, 'error');
    }
  }

  // Always point at the latest runAgent so the listener below can be registered once.
  useEffect(() => {
    runAgentRef.current = runAgent;
  });

  useEffect(() => {
    const handleHeaderRun = () => runAgentRef.current?.();
    window.addEventListener('app:run-agent', handleHeaderRun);
    return () => window.removeEventListener('app:run-agent', handleHeaderRun);
  }, []);

  useEffect(() => {
    if (!loading && caseData && location.state?.autoRun && !autoRunConsumedRef.current) {
      autoRunConsumedRef.current = true;
      // Clear the navigation flag so a page refresh does not start the agent again.
      navigate(location.pathname, { replace: true, state: null });
      runAgentRef.current?.();
    }
  }, [loading, caseData, location.state, location.pathname, navigate]);

  if (loading) {
    return <div className="h-[520px] animate-pulse rounded-[32px] bg-white/[0.035]" />;
  }

  if (error && !caseData) {
    return (
      <div role="alert" className="surface-card rounded-[28px] p-6">
        <p className="font-semibold text-[#ffc7d2]">Could not load this case.</p>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{error}</p>
      </div>
    );
  }

  const canRun = ['READY', 'ACTIONED'].includes(caseData.status);
  const showDiagnosis = !!resultForSections?.diagnosis && (!running || visibleStages.has('DIAGNOSE'));
  const showInterventions = resultForSections?.interventions?.length > 0 && (!running || visibleStages.has('SIMULATE'));
  const showAction = !!resultForSections?.action && (!running || visibleStages.has('ACT') || visibleStages.has('DECIDE'));
  const showOutcome = !!resultForSections?.outcome && (!running || visibleStages.has('MEASURE'));

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] transition hover:text-white">
        <ArrowLeft size={16} /> Back to Cases
      </Link>

      <section className="surface-card rounded-[32px] p-6 lg:p-7">
        <div className="flex items-start justify-between gap-6 max-[900px]:flex-col">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-4xl font-semibold tracking-tight text-white">{caseData.patient.patient_id}</h1>
              <RiskBadge level={caseData.risk.level} />
              <StatusBadge status={caseData.status} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-[var(--text-secondary)]">
              {caseData.patient.age_range ? <span>Age range {caseData.patient.age_range}</span> : null}
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <div className="rounded-[24px] border border-white/8 bg-[var(--surface-elevated)] px-5 py-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                <CircleDollarSign size={14} /> Revenue at Risk
              </div>
              <div className="mt-2 text-4xl font-semibold tracking-tight text-white">{formatCurrency(caseData.risk.revenue_at_risk)}</div>
            </div>

            {canRun ? (
              <button
                type="button"
                disabled={running}
                onClick={runAgent}
                className="agent-pulse inline-flex min-h-14 items-center justify-center gap-2 rounded-[22px] bg-[linear-gradient(180deg,rgba(86,87,232,.96),rgba(74,75,201,.92))] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {running ? <Bot size={18} /> : <Play size={17} className="fill-current" />}
                {running ? 'Agent running…' : caseData.status === 'ACTIONED' ? 'Continue Agent' : 'Run Agent'}
              </button>
            ) : (
              <button
                type="button"
                onClick={retryLoad}
                className="inline-flex min-h-14 items-center justify-center gap-2 rounded-[22px] border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-semibold text-[var(--text-secondary)] transition hover:bg-white/[0.05] hover:text-white"
              >
                <RotateCcw size={16} /> Refresh Case
              </button>
            )}
          </div>
        </div>

        <div className="mt-7">
          <StageProgress visibleStages={visibleStages} visibleTrace={visibleTrace} running={running} caseData={caseData} />
        </div>
      </section>

      <section className="grid grid-cols-[.9fr_1.25fr_.95fr] gap-6 max-[900px]:grid-cols-1">
        <div className="space-y-6">
          <PatientProfileCard patient={caseData.patient} />
          <ObservedBehaviorCard signals={caseData.signals} />
        </div>

        <DiagnosisSimulatorCard
          showDiagnosis={showDiagnosis}
          diagnosis={resultForSections?.diagnosis}
          showInterventions={showInterventions}
          interventions={resultForSections?.interventions || []}
        />

        <SelectedActionCard
          selectedIntervention={selectedIntervention}
          action={showAction ? resultForSections?.action : null}
          outcome={showOutcome ? resultForSections?.outcome : null}
          item={resultForSections}
          running={running}
          busy={approvalBusy}
          onApprove={() => handleApproval('approve')}
          onReject={() => handleApproval('reject')}
        />
      </section>

      <WorkflowJourney
        item={resultForSections}
        visibleStages={visibleStages}
        running={running}
        trace={visibleTrace}
        selectedIntervention={selectedIntervention}
      />

      {error ? (
        <div role="alert" className="rounded-2xl border border-[#ff8ea6]/15 bg-[#ff8ea6]/[0.06] p-4 text-sm text-[#ffc7d2]">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function StageProgress({ visibleStages, visibleTrace, running, caseData }) {
  const completed = (stage) => visibleStages.has(stage) || (!running && caseData.trace?.some((event) => event.stage === stage));
  const latestVisibleStage = visibleTrace.at(-1)?.stage;
  const firstIncompleteStage = stageOrder.find((stage) => !completed(stage));
  const currentStage = running ? (latestVisibleStage || firstIncompleteStage || 'MEASURE') : null;

  return (
    <div className="rounded-[28px] border border-white/8 bg-[var(--surface-elevated)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Workflow Journey</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Observe → Investigate → Diagnose → Simulate → Decide → Act → Measure</p>
        </div>
        <div className="text-xs text-[var(--ice-blue)]">
          {running ? `In progress: ${stageLabels[currentStage] || 'Observe'}` : 'Ready for review'}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-7">
        {stageOrder.map((stage, index) => {
          const isComplete = completed(stage);
          const isCurrent = running && currentStage === stage;
          return (
            <div key={stage} className="relative rounded-2xl border border-white/8 bg-white/[0.02] px-3 py-3 text-center">
              <div className={`mx-auto grid size-9 place-items-center rounded-full border text-sm font-semibold ${isComplete ? 'border-[rgba(119,233,178,.22)] bg-[rgba(119,233,178,.1)] text-[#b8ffd9]' : isCurrent ? 'border-[rgba(140,231,255,.22)] bg-[rgba(140,231,255,.1)] text-[var(--ice-blue)]' : 'border-white/8 bg-transparent text-[var(--text-muted)]'}`}>
                {index + 1}
              </div>
              <div className="mt-2 text-sm font-medium text-white">{stageLabels[stage]}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PatientProfileCard({ patient }) {
  return (
    <div className="surface-card rounded-[32px] p-5 lg:p-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="grid size-11 place-items-center rounded-2xl bg-[rgba(86,87,232,.16)] text-[var(--ice-blue)]">
          <UserRound size={20} />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Patient Record</p>
          <h2 className="mt-1 text-2xl font-semibold text-white">{patient.patient_id}</h2>
        </div>
      </div>

      <div className="space-y-4 rounded-[24px] border border-white/8 bg-[var(--surface-elevated)] p-4">
        {patient.age_range ? <InfoRow label="Age range" value={patient.age_range} /> : null}
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <div className="flex items-center gap-2 text-[var(--text-secondary)]">
        {Icon ? <Icon size={15} className="text-[var(--ice-blue)]" /> : null}
        <span>{label}</span>
      </div>
      <div className="max-w-[60%] text-right font-medium text-white">{value}</div>
    </div>
  );
}

function ObservedBehaviorCard({ signals }) {
  return (
    <div className="surface-card rounded-[32px] p-5 lg:p-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="grid size-11 place-items-center rounded-2xl bg-[rgba(140,231,255,.12)] text-[var(--ice-blue)]">
          <CheckCircle2 size={20} />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Observed Behavior</p>
          <h2 className="mt-1 text-2xl font-semibold text-white">What triggered this case</h2>
        </div>
      </div>

      <div className="space-y-3">
        {signals.map((signal, index) => (
          <div key={`${signal.type}-${index}`} className="rounded-[24px] border border-white/8 bg-white/[0.02] p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-base font-medium text-white">{signal.label}</div>
                <div className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{signal.detail}</div>
              </div>
              <div className="shrink-0 rounded-full border border-white/8 bg-[var(--surface-elevated)] px-2.5 py-1 text-xs font-semibold text-[var(--ice-blue)]">
                {signal.value}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiagnosisSimulatorCard({ showDiagnosis, diagnosis, showInterventions, interventions }) {
  return (
    <div className="surface-card rounded-[32px] p-5 lg:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Diagnosis & Intervention Simulator</p>
          <h2 className="mt-1 text-2xl font-semibold text-white">Reasoning and simulation</h2>
        </div>
      </div>

      <div className="space-y-5">
        <div className="rounded-[24px] border border-white/8 bg-[var(--surface-elevated)] p-5">
          {showDiagnosis && diagnosis ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Primary issue</div>
                  <div className="mt-2 text-3xl font-semibold tracking-tight text-white">{diagnosis.label}</div>
                </div>
                <div className="w-[150px] max-w-full shrink-0">
                  <div className="text-xs font-medium text-[var(--text-secondary)]">Confidence</div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/8">
                      <div className="h-full rounded-full bg-[linear-gradient(90deg,var(--brand),var(--ice-blue))]" style={{ width: `${Math.min(100, Math.max(0, (diagnosis.confidence || 0) * 100))}%` }} />
                    </div>
                    <div className="text-lg font-semibold text-white">{formatPercent(diagnosis.confidence)}</div>
                  </div>
                </div>
              </div>
              <div className="mt-4 rounded-2xl border border-[rgba(140,231,255,.12)] bg-[rgba(140,231,255,.04)] p-4 text-sm leading-6 text-[var(--text-secondary)]">
                {diagnosis.explanation}
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/8 bg-white/[0.02] p-5 text-sm text-[var(--text-secondary)]">
              The diagnosis will appear after the agent reaches the Diagnose stage.
            </div>
          )}
        </div>

        <div className="rounded-[24px] border border-white/8 bg-[var(--surface-elevated)] p-5">
          <div className="mb-4 text-lg font-semibold text-white">Intervention Comparison</div>
          {showInterventions && interventions.length ? (
            <div className="space-y-3">
              {interventions.map((item, index) => (
                <div key={item.intervention_id} className={`rounded-[22px] border p-4 ${item.selected ? 'border-[rgba(140,231,255,.28)] bg-[rgba(140,231,255,.08)]' : 'border-white/8 bg-white/[0.02]'}`}>
                  <div className="flex items-start gap-4">
                    <div className={`grid size-8 place-items-center rounded-full border text-sm font-semibold ${item.selected ? 'border-[rgba(140,231,255,.25)] bg-[rgba(140,231,255,.12)] text-[var(--ice-blue)]' : 'border-white/8 text-[var(--text-muted)]'}`}>
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-white">{item.name}</div>
                        {item.selected ? <span className="rounded-full bg-[#77e9b2]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#b8ffd9]">Recommended</span> : null}
                        {item.requires_approval ? <span className="rounded-full bg-[#ffd48a]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#ffe2ac]">Approval</span> : null}
                      </div>
                      <div className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{item.description}</div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <MiniStat label="Expected recovery" value={formatCurrency(item.expected_recovery)} />
                        <MiniStat label="Estimated cost" value={formatCurrency(item.estimated_cost)} />
                        <MiniStat label="Win probability" value={formatPercent(item.recovery_probability || 0)} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/8 bg-white/[0.02] p-5 text-sm text-[var(--text-secondary)]">
              Simulated intervention options will appear after the agent reaches the Simulate stage.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function SelectedActionCard({ selectedIntervention, action, outcome, item, running, busy, onApprove, onReject }) {
  const requiresApproval = item?.action?.requires_approval && item?.action?.approval_status === 'PENDING';

  return (
    <div className="surface-card rounded-[32px] p-5 lg:p-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="grid size-11 place-items-center rounded-2xl bg-[rgba(86,87,232,.16)] text-[var(--ice-blue)]">
          <ClipboardList size={20} />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Selected Action</p>
          <h2 className="mt-1 text-2xl font-semibold text-white">Execution plan</h2>
        </div>
      </div>

      <div className="space-y-5">
        <div className="rounded-[24px] border border-white/8 bg-[var(--surface-elevated)] p-5">
          {selectedIntervention && action ? (
            <>
              <div className="text-xl font-semibold text-white">{selectedIntervention.name}</div>
              <div className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{action.description}</div>
              <div className="mt-4 grid gap-3">
                <InfoTile label="Assign to" value={action.assignee} />
                <InfoTile label="Priority" value={action.priority} />
                <InfoTile label="Task type" value={action.task_type} />
                <InfoTile label="Due date" value={action.due_date} icon={CalendarDays} />
              </div>
              <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm leading-6 text-[var(--text-secondary)]">
                {action.notes}
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/8 bg-white/[0.02] p-5 text-sm text-[var(--text-secondary)]">
              The selected action will appear once the agent reaches Decide and Act.
            </div>
          )}
        </div>

        {requiresApproval ? (
          <div id="approval-section" className="rounded-[24px] border border-[#ffd48a]/18 bg-[#ffd48a]/[0.06] p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ffe2ac]">Human Approval Required</div>
            <div className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              This intervention affects pricing or finances and must be approved before execution.
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" disabled={busy} onClick={onReject} className="rounded-2xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-[var(--text-secondary)] transition hover:bg-white/[0.05] hover:text-white disabled:opacity-50">
                Reject
              </button>
              <button type="button" disabled={busy} onClick={onApprove} className="rounded-2xl bg-[#ffd48a] px-4 py-2.5 text-sm font-semibold text-[#403000] transition hover:brightness-105 disabled:opacity-50">
                {busy ? 'Working…' : 'Approve Action'}
              </button>
            </div>
          </div>
        ) : null}

        <div className="rounded-[24px] border border-white/8 bg-[var(--surface-elevated)] p-5">
          <div className="text-lg font-semibold text-white">Simulated Outcome</div>
          {outcome ? (
            <div className="mt-4 space-y-3">
              <InfoTile label="Patient rebooked" value={outcome.reengaged ? 'YES' : 'NO'} positive={outcome.reengaged} />
              <InfoTile label="Revenue recovered" value={formatCurrency(outcome.revenue_recovered)} positive />
              <InfoTile label="Estimated cost" value={formatCurrency(outcome.estimated_cost || 0)} />
              <InfoTile label="Net recovered" value={formatCurrency(outcome.net_recovered || 0)} positive />
              <InfoTile label="Running total" value={formatCurrency(outcome.running_total || 0)} positive />
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-white/8 bg-white/[0.02] p-5 text-sm text-[var(--text-secondary)]">
              {running ? 'Outcome will appear when the workflow reaches Measure.' : 'No measured outcome yet.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoTile({ label, value, icon: Icon, positive = false }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm">
      <div className="flex min-w-0 items-center gap-2 text-[var(--text-secondary)]">
        {Icon ? <Icon size={15} className="text-[var(--ice-blue)]" /> : null}
        {label}
      </div>
      <div className={`wrap-anywhere text-right font-semibold ${positive ? 'text-[#b8ffd9]' : 'text-white'}`}>{value}</div>
    </div>
  );
}

function WorkflowJourney({ item, visibleStages, running, trace, selectedIntervention }) {
  const hasStageData = (stage) => {
    if (stage === 'OBSERVE') return Boolean(item.signals?.length);
    if (stage === 'INVESTIGATE') return Boolean(item.investigate);
    if (stage === 'DIAGNOSE') return Boolean(item.diagnosis);
    if (stage === 'SIMULATE') return Boolean(item.interventions?.length);
    if (stage === 'DECIDE') return Boolean(selectedIntervention);
    if (stage === 'ACT') return Boolean(item.action);
    if (stage === 'MEASURE') return Boolean(item.outcome);
    return false;
  };

  const stageComplete = (stage) =>
    visibleStages.has(stage) ||
    (!running && item.status !== 'READY' && (
      item.trace?.some((event) => event.stage === stage) ||
      hasStageData(stage)
    ));

  const showDiagnosis = stageComplete('DIAGNOSE') && item.diagnosis;
  const showInterventions = stageComplete('SIMULATE') && item.interventions?.length;
  const showAction = stageComplete('ACT') && item.action;
  const showOutcome = stageComplete('MEASURE') && item.outcome;

  return (
    <section className="surface-card rounded-[32px] p-5 lg:p-6">
      <div className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
          Workflow Journey
        </p>
        <div className="mt-2 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <h2 className="text-2xl font-semibold text-white">
            Observe → Investigate → Diagnose → Simulate → Decide → Act → Measure
          </h2>
          <p className="text-sm text-[var(--text-secondary)]">
            Seven workflow stages arranged in a four-column workspace.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 max-[767px]:grid-cols-2 max-[520px]:grid-cols-1">
        <WorkflowStageCard stage="OBSERVE" active={stageComplete('OBSERVE')}>
          <div className="space-y-2">
            {item.signals?.map((signal, index) => (
              <div
                key={`${signal.type}-${index}`}
                className="rounded-2xl border border-white/8 bg-white/[0.025] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm font-medium text-white">{signal.label}</div>
                  <span className="shrink-0 rounded-full bg-[rgba(140,231,255,.08)] px-2 py-1 text-[10px] font-semibold text-[var(--ice-blue)]">
                    {signal.value}
                  </span>
                </div>
                <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                  {signal.detail}
                </div>
              </div>
            ))}
          </div>
        </WorkflowStageCard>

        <WorkflowStageCard stage="INVESTIGATE" active={stageComplete('INVESTIGATE')}>
          <div className="space-y-3">
            <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-3">
              <div className="text-sm font-medium text-white">Visit history</div>
              <div className="mt-3 flex h-24 items-end gap-1.5">
                {(item.investigate?.visit_history || []).map((value, index, arr) => {
                  const max = Math.max(...arr, 1);
                  return (
                    <div key={index} className="flex flex-1 items-end">
                      <div
                        className="w-full rounded-t-md bg-[linear-gradient(180deg,rgba(140,231,255,.5),rgba(86,87,232,.28))]"
                        style={{ height: `${Math.max(12, (value / max) * 78)}px` }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-3">
              <div className="text-sm font-medium text-white">Recent activity</div>
              <div className="mt-3 space-y-2">
                {(item.investigate?.recent_activity || []).slice(0, 4).map((entry, index) => (
                  <div key={index} className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-white">{entry.label}</div>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${entry.status === 'NEGATIVE' ? 'bg-[#ff8ea6]/10 text-[#ffc7d2]' : entry.status === 'POSITIVE' ? 'bg-[#77e9b2]/10 text-[#b8ffd9]' : 'bg-[rgba(140,231,255,.1)] text-[var(--ice-blue)]'}`}>
                        {entry.status}
                      </span>
                    </div>
                    <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{entry.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </WorkflowStageCard>

        <WorkflowStageCard stage="DIAGNOSE" active={stageComplete('DIAGNOSE')}>
          {showDiagnosis ? (
            <div className="space-y-3">
              <div className="rounded-2xl border border-[rgba(140,231,255,.14)] bg-[rgba(140,231,255,.05)] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  Primary issue
                </div>
                <div className="mt-2 text-xl font-semibold text-white">{item.diagnosis.label}</div>
                <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                  <span className="text-[var(--text-secondary)]">Confidence</span>
                  <span className="font-semibold text-[var(--ice-blue)]">
                    {formatPercent(item.diagnosis.confidence)}
                  </span>
                </div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-3 text-xs leading-5 text-[var(--text-secondary)]">
                {item.diagnosis.explanation}
              </div>
            </div>
          ) : (
            <Placeholder text="Diagnosis will appear once the workflow reaches this stage." />
          )}
        </WorkflowStageCard>

        <WorkflowStageCard stage="SIMULATE" active={stageComplete('SIMULATE')}>
          {showInterventions ? (
            <div className="space-y-2">
              {item.interventions.map((option) => (
                <div
                  key={option.intervention_id}
                  className={`rounded-2xl border p-3 ${
                    option.selected
                      ? 'border-[rgba(140,231,255,.24)] bg-[rgba(140,231,255,.07)]'
                      : 'border-white/8 bg-white/[0.025]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm font-medium text-white">{option.name}</div>
                    {option.selected ? (
                      <span className="rounded-full bg-[#77e9b2]/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#b8ffd9]">
                        Best
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-[var(--text-muted)]">Recovery</div>
                      <div className="mt-0.5 font-semibold text-white">
                        {formatCurrency(option.expected_recovery)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[var(--text-muted)]">Net value</div>
                      <div className="mt-0.5 font-semibold text-white">
                        {formatCurrency(option.net_value)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Placeholder text="Simulation options will appear here." />
          )}
        </WorkflowStageCard>

        <WorkflowStageCard stage="DECIDE" active={stageComplete('DECIDE')}>
          {selectedIntervention ? (
            <div className="space-y-3">
              <div className="rounded-2xl border border-[rgba(140,231,255,.18)] bg-[rgba(140,231,255,.06)] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  Recommended action
                </div>
                <div className="mt-2 text-xl font-semibold text-white">{selectedIntervention.name}</div>
                <div className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
                  {selectedIntervention.description}
                </div>
              </div>
              <div className="grid gap-2">
                <MiniStat label="Expected recovery" value={formatCurrency(selectedIntervention.expected_recovery)} />
                <MiniStat label="Cost" value={formatCurrency(selectedIntervention.estimated_cost)} />
                <MiniStat label="Net value" value={formatCurrency(selectedIntervention.net_value)} />
              </div>
            </div>
          ) : (
            <Placeholder text="The selected intervention will appear here." />
          )}
        </WorkflowStageCard>

        <WorkflowStageCard stage="ACT" active={stageComplete('ACT')}>
          {showAction ? (
            <div className="space-y-2">
              <InfoTile label="Action type" value={item.action.task_type || item.action.type} />
              <InfoTile label="Assigned to" value={item.action.assignee || '—'} />
              <InfoTile label="Priority" value={item.action.priority || '—'} />
              <InfoTile label="Due date" value={item.action.due_date || '—'} />
            </div>
          ) : (
            <Placeholder text="Execution details will appear here." />
          )}
        </WorkflowStageCard>

        <WorkflowStageCard stage="MEASURE" active={stageComplete('MEASURE')}>
          {showOutcome ? (
            <div className="space-y-2">
              <InfoTile
                label="Patient rebooked"
                value={item.outcome.reengaged ? 'YES' : 'NO'}
                positive={item.outcome.reengaged}
              />
              <InfoTile
                label="Revenue recovered"
                value={formatCurrency(item.outcome.revenue_recovered)}
                positive
              />
              <InfoTile
                label="Net recovered"
                value={formatCurrency(item.outcome.net_recovered || 0)}
                positive
              />
              <InfoTile
                label="Running total"
                value={formatCurrency(item.outcome.running_total || 0)}
                positive
              />
            </div>
          ) : (
            <Placeholder text="Measured outcome will appear here." />
          )}
        </WorkflowStageCard>
      </div>

      {trace.length ? (
        <div className="mt-6 rounded-[24px] border border-white/8 bg-[var(--surface-elevated)] p-5">
          <div className="mb-4 text-sm font-medium text-white">Agent Activity Log</div>
          <div className="grid grid-cols-4 gap-3 max-[767px]:grid-cols-2 max-[520px]:grid-cols-1">
            {trace.map((event) => (
              <div
                key={event.id}
                className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {stageLabels[event.stage]}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${event.status === 'WAITING' ? 'bg-[#ffd48a]/10 text-[#ffe2ac]' : 'bg-[#77e9b2]/10 text-[#b8ffd9]'}`}>
                    {event.status}
                  </span>
                </div>
                <div className="mt-2 font-medium text-white">{event.title}</div>
                <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{event.summary}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function WorkflowStageCard({ stage, active, children }) {
  const stageNumber = stageOrder.indexOf(stage) + 1;

  return (
    <article
      className={`flex min-h-[340px] flex-col rounded-[24px] border p-4 ${
        active
          ? 'border-[rgba(140,231,255,.16)] bg-[rgba(255,255,255,.025)] shadow-[0_14px_38px_rgba(0,0,0,.18)]'
          : 'border-white/8 bg-white/[0.015]'
      }`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            Stage {stageNumber}
          </div>
          <div className="mt-1 text-xl font-semibold text-white">{stageLabels[stage]}</div>
        </div>
        <div
          className={`grid size-8 shrink-0 place-items-center rounded-full border text-xs font-semibold ${
            active
              ? 'border-[rgba(140,231,255,.24)] bg-[rgba(140,231,255,.1)] text-[var(--ice-blue)]'
              : 'border-white/8 bg-white/[0.03] text-[var(--text-muted)]'
          }`}
        >
          {stageNumber}
        </div>
      </div>

      <div className="mb-4 h-px bg-white/8" />
      <div className="flex-1">{children}</div>

      <div
        className={`mt-4 inline-flex w-fit rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
          active
            ? 'bg-[rgba(140,231,255,.1)] text-[var(--ice-blue)]'
            : 'bg-white/[0.04] text-[var(--text-muted)]'
        }`}
      >
        {active ? 'Active / Completed' : 'Pending'}
      </div>
    </article>
  );
}

function Placeholder({ text }) {
  return (
    <div className="rounded-[18px] border border-dashed border-white/8 bg-white/[0.02] p-4 text-sm leading-6 text-[var(--text-secondary)]">
      {text}
    </div>
  );
}
