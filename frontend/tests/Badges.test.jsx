import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RiskBadge, StatusBadge } from '../src/components/ui/Badges.jsx';

describe('RiskBadge', () => {
  it.each([
    ['HIGH', 'High Risk'],
    ['MEDIUM', 'Medium Risk'],
    ['LOW', 'Low Risk'],
  ])('renders %s as "%s"', (level, label) => {
    render(<RiskBadge level={level} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('defaults to Low Risk when level is missing', () => {
    render(<RiskBadge />);
    expect(screen.getByText('Low Risk')).toBeInTheDocument();
  });
});

describe('StatusBadge', () => {
  it.each([
    ['READY', 'Needs Analysis'],
    ['RESCUED', 'Rescued'],
    ['ACTIONED', 'Action Recorded'],
    ['AWAITING_APPROVAL', 'Needs Approval'],
    ['REVIEW', 'Review'],
  ])('maps %s to "%s"', (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('humanizes unknown statuses and handles missing ones', () => {
    const { rerender } = render(<StatusBadge status="SOME_NEW_STATE" />);
    expect(screen.getByText('SOME NEW STATE')).toBeInTheDocument();
    rerender(<StatusBadge />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });
});
