import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const summary = {
  cases_detected: 137,
  high_risk_cases: 24,
  revenue_at_risk: 84250,
  potentially_recoverable: 31800,
  revenue_recovered: 32690,
  actions_executed: 18,
  awaiting_approval: 4,
  revenue_series: [1, 2, 3],
  agent_activity: [],
  approval_thresholds: [],
};

const makeCase = (id, status, revenue, level = 'HIGH') => ({
  case_id: id,
  patient: { patient_id: `PT-${id}`, name: `Patient ${id}` },
  risk: { level, revenue_at_risk: revenue },
  issue: 'Issue',
  last_activity_at: 'now',
  status,
});

const getSummary = vi.fn();
const getCases = vi.fn();

vi.mock('../src/api/agentApi.js', () => ({
  agentApi: {
    getSummary: (...args) => getSummary(...args),
    getCases: (...args) => getCases(...args),
  },
  apiMode: 'MOCK',
}));

const { default: DashboardPage } = await import('../src/pages/DashboardPage.jsx');

const renderPage = () =>
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );

describe('DashboardPage', () => {
  beforeEach(() => {
    getSummary.mockReset();
    getCases.mockReset();
  });

  it('shows an accessible error when loading fails', async () => {
    getSummary.mockRejectedValue(new Error('Backend offline'));
    getCases.mockResolvedValue({ cases: [] });
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not load the dashboard/i);
    expect(alert).toHaveTextContent('Backend offline');
  });

  it('renders summary metrics and the case queue sorted by revenue at risk', async () => {
    getSummary.mockResolvedValue(summary);
    getCases.mockResolvedValue({
      cases: [makeCase('A', 'READY', 300), makeCase('B', 'READY', 900), makeCase('C', 'RESCUED', 500)],
    });
    renderPage();

    expect(await screen.findByText('$84,250')).toBeInTheDocument();
    const rows = screen.getAllByText(/^PT-/).map((node) => node.textContent);
    expect(rows).toEqual(['PT-B', 'PT-C', 'PT-A']);
  });

  it('does not crash when the backend returns no cases field', async () => {
    getSummary.mockResolvedValue(summary);
    getCases.mockResolvedValue({});
    renderPage();
    expect(await screen.findByText('$84,250')).toBeInTheDocument();
    expect(screen.queryByText(/^PT-/)).not.toBeInTheDocument();
  });

  it('hides the trend badge and date labels when the backend does not send them', async () => {
    getSummary.mockResolvedValue(summary);
    getCases.mockResolvedValue({ cases: [] });
    renderPage();
    await screen.findByText('$84,250');
    expect(screen.queryByText(/vs\. previous 30 days/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Apr 1')).not.toBeInTheDocument();
  });

  it('shows the trend badge when recovery_change_pct is provided', async () => {
    getSummary.mockResolvedValue({ ...summary, recovery_change_pct: 12 });
    getCases.mockResolvedValue({ cases: [] });
    renderPage();
    expect(await screen.findByText(/\+12%/)).toBeInTheDocument();
  });

  it('filters the queue to cases awaiting approval when that card is clicked', async () => {
    getSummary.mockResolvedValue(summary);
    getCases.mockResolvedValue({
      cases: [makeCase('A', 'READY', 300), makeCase('B', 'AWAITING_APPROVAL', 900)],
    });
    const notices = [];
    const onNotice = (event) => notices.push(event.detail);
    window.addEventListener('app:notice', onNotice);

    renderPage();
    await screen.findByText('PT-A');
    await userEvent.click(screen.getByRole('button', { name: /^need approval/i }));

    await waitFor(() => expect(screen.queryByText('PT-A')).not.toBeInTheDocument());
    expect(screen.getByText('PT-B')).toBeInTheDocument();
    expect(notices.at(-1).message).toMatch(/1 match/);
    window.removeEventListener('app:notice', onNotice);
  });
});
