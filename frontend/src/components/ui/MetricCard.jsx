export default function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = 'indigo',
  active = false,
  onClick,
}) {
  const accents = {
    indigo: 'from-[rgba(86,87,232,.18)] to-[rgba(138,112,246,.06)] text-[var(--ice-blue)] border-[rgba(140,231,255,.18)]',
    rose: 'from-[rgba(239,68,68,.16)] to-[rgba(239,68,68,.05)] text-[#ffb2bf] border-[rgba(255,178,191,.16)]',
    violet: 'from-[rgba(138,112,246,.18)] to-[rgba(86,87,232,.06)] text-[#c6b8ff] border-[rgba(138,112,246,.22)]',
    ice: 'from-[rgba(140,231,255,.16)] to-[rgba(86,87,232,.06)] text-[var(--ice-blue)] border-[rgba(140,231,255,.18)]',
    emerald: 'from-[rgba(52,211,153,.14)] to-[rgba(52,211,153,.05)] text-[#b8ffd9] border-[rgba(184,255,217,.18)]',
  };

  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`group relative overflow-hidden rounded-3xl border bg-[var(--surface)] p-5 text-left shadow-[0_16px_46px_rgba(0,0,0,.24)] transition ${
        onClick ? 'hover:-translate-y-0.5 hover:border-white/16' : ''
      } ${active ? 'border-[rgba(140,231,255,.2)] ring-1 ring-[rgba(140,231,255,.16)]' : 'border-white/8'} `}
    >
      <div className={`absolute inset-x-0 top-0 h-16 bg-gradient-to-b ${accents[accent].split(' ').slice(0, 2).join(' ')} opacity-80`} />
      <div className="relative flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="wrap-anywhere text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">{label}</p>
          <p className="wrap-anywhere mt-3 text-3xl font-semibold tracking-tight text-white">{value}</p>
          {hint ? <p className="wrap-anywhere mt-2 text-sm text-[var(--text-secondary)]">{hint}</p> : null}
        </div>
        {Icon ? (
          <div className={`grid size-11 shrink-0 place-items-center rounded-2xl border bg-gradient-to-b ${accents[accent]}`}>
            <Icon size={20} />
          </div>
        ) : null}
      </div>
      {onClick ? (
        <div className="wrap-anywhere relative mt-4 text-xs font-medium text-[var(--text-muted)] transition group-hover:text-[var(--ice-blue)]">
          Click to filter queue
        </div>
      ) : null}
    </Wrapper>
  );
}
