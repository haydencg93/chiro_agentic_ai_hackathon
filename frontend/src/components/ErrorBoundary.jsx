import { Component } from 'react';

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div role="alert" className="grid min-h-screen place-items-center bg-[var(--canvas)] p-6 text-[var(--text-primary)]">
        <div className="surface-card max-w-md rounded-[28px] p-6 text-center">
          <p className="text-lg font-semibold">Something went wrong.</p>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            The page hit an unexpected error. Reloading usually fixes it.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
