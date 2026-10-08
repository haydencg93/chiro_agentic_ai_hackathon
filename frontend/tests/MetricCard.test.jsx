import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import MetricCard from '../src/components/ui/MetricCard.jsx';

describe('MetricCard', () => {
  it('renders label, value and hint as a non-interactive card', () => {
    render(<MetricCard label="Revenue at risk" value="$84,250" hint="24 high risk" />);
    expect(screen.getByText('Revenue at risk')).toBeInTheDocument();
    expect(screen.getByText('$84,250')).toBeInTheDocument();
    expect(screen.getByText('24 high risk')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('becomes a real button and fires onClick when clickable', async () => {
    const onClick = vi.fn();
    render(<MetricCard label="Cases" value="137" onClick={onClick} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
