import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import AppShell from '../src/components/layout/AppShell.jsx';

describe('REALIGN header branding', () => {
  it('uses one official logo as the dashboard link without duplicate branding text', () => {
    render(<MemoryRouter initialEntries={['/cases/CASE-PT1']}><AppShell /></MemoryRouter>);
    const logo = screen.getByRole('img', { name: 'REALIGN' });
    expect(logo).toHaveAttribute('src', expect.stringContaining('realign_logo.png'));
    expect(screen.getByRole('link', { name: 'REALIGN dashboard' })).toHaveAttribute('href', '/');
    expect(screen.queryByText('REALIGN')).not.toBeInTheDocument();
    expect(screen.queryByText("It's time to Realign")).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search cases' })).toBeInTheDocument();
  });
});
