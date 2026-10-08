import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import CaseTable from '../src/components/dashboard/CaseTable.jsx';

const cases = [
  {
    case_id: 'CASE-1',
    patient: { patient_id: 'PT001', name: 'Alex Example' },
    risk: { level: 'HIGH', revenue_at_risk: 1240 },
    issue: 'Scheduling friction',
    last_activity_at: '2 hours ago',
    status: 'READY',
  },
  {
    case_id: 'CASE 2/odd',
    patient: { patient_id: 'PT002', name: 'Sam Sample' },
    risk: { level: 'LOW', revenue_at_risk: 320 },
    issue: 'Value concern',
    last_activity_at: 'Yesterday',
    status: 'REVIEW',
  },
];

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

const renderTable = () =>
  render(
    <MemoryRouter>
      <CaseTable cases={cases} />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

describe('CaseTable', () => {
  it('renders one row per case with formatted values and badges', () => {
    renderTable();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByText('PT001')).toBeInTheDocument();
    expect(screen.getByText('$1,240')).toBeInTheDocument();
    expect(screen.getByText('High Risk')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('navigates to the case page when a row is clicked', async () => {
    renderTable();
    await userEvent.click(screen.getByText('PT001'));
    expect(screen.getByTestId('where')).toHaveTextContent('/cases/CASE-1');
  });

  it('URL-encodes unusual case ids', async () => {
    renderTable();
    await userEvent.click(screen.getByText('PT002'));
    expect(screen.getByTestId('where')).toHaveTextContent('/cases/CASE%202%2Fodd');
  });
});
