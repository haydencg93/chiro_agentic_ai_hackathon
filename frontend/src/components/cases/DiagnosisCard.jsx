import { BrainCircuit } from 'lucide-react';
import { formatPercent } from '../../utils/formatters.js';

export default function DiagnosisCard({ diagnosis }) {
  if (!diagnosis) return null;

  return (
    <div className="reveal-up rounded-2xl border border-violet-300/12 bg-violet-300/[0.045] p-5">
      <div className="flex items-start gap-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-violet-300/15 bg-violet-300/[0.08] text-violet-200">
          <BrainCircuit size={20} />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-200/65">Agent diagnosis</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h3 className="text-xl font-semibold text-white">{diagnosis.label}</h3>
            <span className="rounded-full border border-violet-300/15 bg-violet-300/[0.06] px-2.5 py-1 text-xs text-violet-100">
              {formatPercent(diagnosis.confidence)} confidence
            </span>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">{diagnosis.explanation}</p>
        </div>
      </div>
    </div>
  );
}
