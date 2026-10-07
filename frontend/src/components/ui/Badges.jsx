export function RiskBadge({ level }) {
  const classes = {
    HIGH: 'border-[#ff8ea6]/25 bg-[#ff8ea6]/10 text-[#ffc7d2]',
    MEDIUM: 'border-[#ffd48a]/25 bg-[#ffd48a]/10 text-[#ffe2ac]',
    LOW: 'border-[rgba(140,231,255,.22)] bg-[rgba(140,231,255,.1)] text-[var(--ice-blue)]',
  };
  const label = level ? `${level.charAt(0)}${level.slice(1).toLowerCase()} Risk` : 'Low Risk';
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold tracking-wide ${classes[level] || classes.LOW}`}>
      {label}
    </span>
  );
}

export function StatusBadge({ status }) {
  const classes = {
    READY: 'border-[rgba(140,231,255,.22)] bg-[rgba(140,231,255,.1)] text-[var(--ice-blue)]',
    RESCUED: 'border-[#77e9b2]/25 bg-[#77e9b2]/10 text-[#b8ffd9]',
    ACTIONED: 'border-[#8fb7ff]/25 bg-[#8fb7ff]/10 text-[#cbdcff]',
    AWAITING_APPROVAL: 'border-[#ffd48a]/25 bg-[#ffd48a]/10 text-[#ffe2ac]',
    REVIEW: 'border-[#c6b8ff]/25 bg-[#c6b8ff]/10 text-[#ddd4ff]',
  };
  const labelMap = {
    READY: 'Open',
    RESCUED: 'Rescued',
    ACTIONED: 'Actioned',
    AWAITING_APPROVAL: 'Need Approval',
    REVIEW: 'Review',
  };
  const label = labelMap[status] || status?.replaceAll('_', ' ') || 'Unknown';
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold tracking-wide ${classes[status] || 'border-white/10 bg-white/5 text-slate-300'}`}>
      {label}
    </span>
  );
}
