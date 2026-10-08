import { beforeEach, describe, expect, it, vi } from 'vitest';

// The mock API keeps state in module scope, so load a fresh copy for every test.
let api;
beforeEach(async () => {
  vi.resetModules();
  api = await import('../src/api/mockApi.js');
});

const AWAITING = 'CASE-0031829';
const GOLDEN = 'CASE-0054827';
const ACTIONED = 'CASE-0089321';
const REVIEW = 'CASE-0049921';

describe('read endpoints', () => {
  it('returns a summary with the fields the dashboard needs', async () => {
    const summary = await api.getMockSummary();
    expect(summary.revenue_recovered).toBeGreaterThan(0);
    expect(Array.isArray(summary.revenue_series)).toBe(true);
    expect(summary.revenue_labels).toHaveLength(summary.revenue_series.length);
    expect(Array.isArray(summary.agent_activity)).toBe(true);
    expect(Array.isArray(summary.approval_thresholds)).toBe(true);
  });

  it('lists cases with the required shape', async () => {
    const { cases } = await api.getMockCases();
    expect(cases.length).toBeGreaterThan(0);
    for (const item of cases) {
      expect(item.case_id).toMatch(/^CASE-/);
      expect(item.patient.patient_id).toBeTruthy();
      expect(item.risk.revenue_at_risk).toBeTypeOf('number');
      expect(item.status).toBeTruthy();
    }
  });

  it('returns a copy, so callers cannot mutate stored state', async () => {
    const first = await api.getMockCase(GOLDEN);
    first.status = 'TAMPERED';
    const second = await api.getMockCase(GOLDEN);
    expect(second.status).not.toBe('TAMPERED');
  });

  it('throws for an unknown case', async () => {
    await expect(api.getMockCase('CASE-NOPE')).rejects.toThrow(/not found/i);
  });
});

describe('runMockCase', () => {
  it('runs the demo case to RESCUED with a measured outcome', async () => {
    const result = await api.runMockCase(GOLDEN);
    expect(result.success).toBe(true);
    expect(result.case.status).toBe('RESCUED');
    expect(result.case.outcome.revenue_recovered).toBeGreaterThan(0);
    const stored = await api.getMockCase(GOLDEN);
    expect(stored.status).toBe('RESCUED');
  });

  it('measures an already-actioned case and appends a MEASURE step', async () => {
    const before = await api.getMockCase(ACTIONED);
    const result = await api.runMockCase(ACTIONED);
    expect(result.continued_from).toBe('MEASURE');
    expect(result.case.status).toBe('RESCUED');
    expect(result.case.outcome.status).toBe('MEASURED');
    expect(result.case.trace.length).toBe(before.trace.length + 1);
    expect(result.case.trace.at(-1).stage).toBe('MEASURE');
  });

  it('refuses to run a case that needs manual review', async () => {
    await expect(api.runMockCase(REVIEW)).rejects.toThrow(/manual review/i);
  });
});

describe('approval workflow', () => {
  it('approve executes the action and records the outcome', async () => {
    const result = await api.approveMockCase(AWAITING);
    expect(result.continued_from).toBe('ACT');
    expect(result.case.status).toBe('RESCUED');
    expect(result.case.action.approval_status).toBe('APPROVED');
    expect(result.case.action.status).toBe('EXECUTED');
    expect(result.case.outcome.net_recovered).toBeGreaterThanOrEqual(0);
    expect(result.case.trace.at(-1).stage).toBe('MEASURE');
  });

  it('reject falls back to a safe option that needs no approval', async () => {
    const result = await api.rejectMockCase(AWAITING);
    expect(result.continued_from).toBe('SIMULATE');
    expect(result.case.status).toBe('RESCUED');
    expect(result.case.action.requires_approval).toBe(false);
    const selected = result.case.interventions.filter((item) => item.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0].requires_approval).toBe(false);
  });

  it('cannot approve or reject the same case twice', async () => {
    await api.approveMockCase(AWAITING);
    await expect(api.approveMockCase(AWAITING)).rejects.toThrow(/pending approval/i);
    await expect(api.rejectMockCase(AWAITING)).rejects.toThrow(/pending approval/i);
  });

  it('cannot approve a case that never needed approval', async () => {
    await expect(api.approveMockCase(GOLDEN)).rejects.toThrow(/pending approval/i);
  });

  it('computes net recovered as recovery minus cost, never negative', async () => {
    const { case: updated } = await api.approveMockCase(AWAITING);
    const { revenue_recovered, estimated_cost, net_recovered } = updated.outcome;
    expect(net_recovered).toBe(Math.max(0, revenue_recovered - estimated_cost));
  });
});
