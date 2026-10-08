import { initialCases, processedGoldenCase } from '../data/mockCases.js';

const BASE_RECOVERED_TOTAL = 32690; // matches summary.revenue_recovered in the mock summary
const wait = (ms = 320) => new Promise((resolve) => setTimeout(resolve, ms));
const clone = (value) => JSON.parse(JSON.stringify(value));

let cases = clone(initialCases);

function findCase(caseId) {
  const found = cases.find((item) => item.case_id === caseId);
  if (!found) {
    throw new Error(`Case ${caseId} was not found.`);
  }
  return found;
}

export async function getMockSummary() {
  await wait(220);
  return {
    cases_detected: 137,
    high_risk_cases: 24,
    revenue_at_risk: 84250,
    potentially_recoverable: 31800,
    revenue_recovered: BASE_RECOVERED_TOTAL,
    actions_executed: 18,
    awaiting_approval: 4,
    revenue_series: [1200, 1600, 2200, 1800, 2500, 2900, 3400, 3100, 3700, 3900, 4200, 4600],
    revenue_labels: ['Apr 1', 'Apr 4', 'Apr 7', 'Apr 10', 'Apr 13', 'Apr 16', 'Apr 19', 'Apr 22', 'Apr 25', 'Apr 28', 'Apr 29', 'Apr 30'],
    recovery_change_pct: 18,
    agent_activity: [
      {
        title: 'Analyzed PT0054827',
        detail: 'Identified decline in visit frequency and 2 cancellations.',
        time: '10:14 AM',
      },
      {
        title: 'Diagnosed scheduling friction',
        detail: 'Primary issue with 84% confidence.',
        time: '10:14 AM',
      },
      {
        title: 'Compared 4 interventions',
        detail: 'Simulated potential outcomes and ROI.',
        time: '10:14 AM',
      },
      {
        title: 'Selected rescheduling',
        detail: 'Highest expected value ($890).',
        time: '10:15 AM',
      },
      {
        title: 'Created outreach task',
        detail: 'Assigned to Scheduling Team.',
        time: '10:15 AM',
      },
      {
        title: 'Estimated $890 recovered',
        detail: 'If patient rebooks as projected.',
        time: '10:15 AM',
      },
    ],
    approval_thresholds: [
      { label: 'Low Risk', range: '≤ $500', mode: 'Auto-execute', tone: 'positive' },
      { label: 'Medium Risk', range: '$501 – $1,500', mode: 'Auto-execute', tone: 'positive' },
      { label: 'High Risk', range: '> $1,500', mode: 'Manager approval', tone: 'warning' },
    ],
  };
}

export async function getMockCases() {
  await wait(280);
  return { cases: clone(cases) };
}

export async function getMockCase(caseId) {
  await wait(250);
  return clone(findCase(caseId));
}

export async function runMockCase(caseId) {
  await wait(700);
  const current = findCase(caseId);

  if (caseId === processedGoldenCase.case_id) {
    cases = cases.map((item) =>
      item.case_id === caseId ? clone(processedGoldenCase) : item,
    );
    return { success: true, case: clone(processedGoldenCase) };
  }

  if (current.status === 'ACTIONED' && !current.outcome) {
    const selected = current.interventions?.find((item) => item.selected);
    const recovered = selected?.expected_recovery || 0;
    const cost = selected?.estimated_cost || 0;
    const updated = {
      ...current,
      status: 'RESCUED',
      outcome: {
        status: 'MEASURED',
        reengaged: true,
        revenue_recovered: recovered,
        estimated_cost: cost,
        net_recovered: Math.max(0, recovered - cost),
        running_total: BASE_RECOVERED_TOTAL + recovered,
        detail: 'The previously executed action was measured and the simulated outcome was recorded.',
      },
      trace: [
        ...(current.trace || []),
        {
          id: `evt-continue-measure-${caseId}`,
          stage: 'MEASURE',
          type: 'OUTCOME',
          title: `${recovered ? `$${recovered} simulated revenue recovered` : 'Outcome measured'}`,
          summary: 'The agent resumed from the executed action and completed the Measure stage.',
          status: 'COMPLETED',
        },
      ],
    };
    cases = cases.map((item) => (item.case_id === caseId ? updated : item));
    return { success: true, case: clone(updated), continued_from: 'MEASURE' };
  }

  if (current.status === 'REVIEW') {
    throw new Error('This case requires manual review before the agent can run again.');
  }

  return { success: true, case: clone(current) };
}

export async function approveMockCase(caseId) {
  await wait(500);
  const current = findCase(caseId);

  if (!current.action?.requires_approval || current.action.approval_status !== 'PENDING') {
    throw new Error('This case does not have a pending approval.');
  }

  const selected = current.interventions.find((item) => item.selected);
  const recovered = selected?.expected_recovery || 0;
  const cost = selected?.estimated_cost || 0;

  const updated = {
    ...current,
    status: 'RESCUED',
    action: {
      ...current.action,
      status: 'EXECUTED',
      approval_status: 'APPROVED',
      description: 'Manager approved the selected intervention and the agent executed it.',
    },
    outcome: {
      status: 'MEASURED',
      reengaged: true,
      revenue_recovered: recovered,
      estimated_cost: cost,
      net_recovered: Math.max(0, recovered - cost),
      running_total: BASE_RECOVERED_TOTAL + recovered,
      detail: 'Approval was granted, the action executed, and the simulated follow-up indicates successful re-engagement.',
    },
    trace: [
      ...current.trace,
      {
        id: `evt-approved-${caseId}`,
        stage: 'ACT',
        type: 'ACTION_EXECUTED',
        title: 'Manager approved action',
        summary: 'The financial intervention was authorized and executed.',
        status: 'COMPLETED',
      },
      {
        id: `evt-approved-measure-${caseId}`,
        stage: 'MEASURE',
        type: 'OUTCOME',
        title: `${recovered ? `$${recovered} simulated revenue recovered` : 'Outcome measured'}`,
        summary: 'The agent continued after approval and measured the simulated business outcome.',
        status: 'COMPLETED',
      },
    ],
  };

  cases = cases.map((item) => (item.case_id === caseId ? updated : item));
  return { success: true, case: clone(updated), continued_from: 'ACT' };
}

export async function rejectMockCase(caseId) {
  await wait(500);
  const current = findCase(caseId);

  if (!current.action?.requires_approval || current.action.approval_status !== 'PENDING') {
    throw new Error('This case does not have a pending approval.');
  }

  const fallback = current.interventions.find((item) => !item.requires_approval && !item.selected);

  if (!fallback) {
    const reviewOnly = {
      ...current,
      status: 'REVIEW',
      action: {
        ...current.action,
        status: 'REJECTED',
        approval_status: 'REJECTED',
        description: 'Manager rejected the selected intervention. No automatic fallback is available.',
      },
      trace: [
        ...current.trace,
        {
          id: `evt-rejected-${caseId}`,
          stage: 'ACT',
          type: 'ACTION_REJECTED',
          title: 'Manager rejected action',
          summary: 'The case returned for human review because no safe automatic fallback was available.',
          status: 'COMPLETED',
        },
      ],
    };
    cases = cases.map((item) => (item.case_id === caseId ? reviewOnly : item));
    return { success: true, case: clone(reviewOnly), continued_from: 'ACT' };
  }

  const recovered = fallback.expected_recovery || 0;
  const cost = fallback.estimated_cost || 0;
  const interventions = current.interventions.map((item) => ({
    ...item,
    selected: item.intervention_id === fallback.intervention_id,
  }));

  const updated = {
    ...current,
    status: 'RESCUED',
    interventions,
    action: {
      action_id: `ACT-FALLBACK-${caseId}`,
      type: 'VALUE_EDUCATION_OUTREACH',
      status: 'EXECUTED',
      requires_approval: false,
      approval_status: 'NOT_REQUIRED',
      description: 'The rejected financial action triggered a re-simulation. The agent selected and executed a non-financial fallback.',
      assignee: 'Retention Team',
      priority: 'High',
      task_type: 'Patient outreach',
      due_date: 'Today',
      notes: 'Explain remaining care-plan value and offer assistance without changing patient pricing.',
    },
    outcome: {
      status: 'MEASURED',
      reengaged: true,
      revenue_recovered: recovered,
      estimated_cost: cost,
      net_recovered: Math.max(0, recovered - cost),
      running_total: BASE_RECOVERED_TOTAL + recovered,
      detail: 'The financial action was declined, so the agent selected a safe fallback and measured its simulated result.',
    },
    trace: [
      ...current.trace,
      {
        id: `evt-rejected-${caseId}`,
        stage: 'ACT',
        type: 'ACTION_REJECTED',
        title: 'Manager rejected financial action',
        summary: 'The agent returned to intervention simulation instead of stopping the workflow.',
        status: 'COMPLETED',
      },
      {
        id: `evt-resimulate-${caseId}`,
        stage: 'SIMULATE',
        type: 'INTERVENTION_COMPARISON',
        title: 'Safe alternatives re-simulated',
        summary: `${fallback.name} became the strongest option that did not require approval.`,
        status: 'COMPLETED',
      },
      {
        id: `evt-redecide-${caseId}`,
        stage: 'DECIDE',
        type: 'DECISION',
        title: `${fallback.name} selected`,
        summary: 'The agent selected the highest-value safe fallback after the original action was declined.',
        status: 'COMPLETED',
      },
      {
        id: `evt-fallback-act-${caseId}`,
        stage: 'ACT',
        type: 'ACTION_EXECUTED',
        title: 'Fallback outreach executed',
        summary: 'The non-financial outreach task was created for the retention team.',
        status: 'COMPLETED',
      },
      {
        id: `evt-fallback-measure-${caseId}`,
        stage: 'MEASURE',
        type: 'OUTCOME',
        title: `$${recovered} simulated revenue recovered`,
        summary: 'The workflow continued through Measure after the rejected approval path.',
        status: 'COMPLETED',
      },
    ],
  };

  cases = cases.map((item) => (item.case_id === caseId ? updated : item));
  return { success: true, case: clone(updated), continued_from: 'SIMULATE' };
}
