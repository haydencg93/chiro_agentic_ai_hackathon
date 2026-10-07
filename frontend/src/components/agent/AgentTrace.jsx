import {
  BrainCircuit, Check, CircleDot, Crosshair,
  Gauge, Scale, Search, Send, Wrench,
} from 'lucide-react';

const stageIcons = {
  OBSERVE: Crosshair,
  INVESTIGATE: Search,
  DIAGNOSE: BrainCircuit,
  SIMULATE: Scale,
  DECIDE: CircleDot,
  ACT: Send,
  MEASURE: Gauge,
};

export default function AgentTrace({ trace = [], running = false }) {
  if (!trace.length && !running) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center">
        <BrainCircuit className="mx-auto text-slate-600" size={26} />
        <p className="mt-3 font-medium text-slate-300">Agent has not run yet</p>
        <p className="mt-1 text-sm text-slate-500">Run the case to watch the auditable decision trace appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {trace.map((event, index) => {
        const Icon = stageIcons[event.stage] || Wrench;
        const isWaiting = event.status === 'WAITING';
        return (
          <div key={event.id} className="reveal-up relative flex gap-4 rounded-2xl border border-white/8 bg-white/[0.025] p-4">
            <div className={`grid size-10 shrink-0 place-items-center rounded-xl border ${isWaiting ? 'border-amber-300/20 bg-amber-300/10 text-amber-200' : 'border-cyan-300/15 bg-cyan-300/[0.07] text-cyan-200'}`}>
              <Icon size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{event.stage}</span>
                {event.tool && (
                  <span className="rounded-md border border-violet-300/10 bg-violet-300/[0.06] px-2 py-0.5 font-mono text-[10px] text-violet-200/90">{event.tool}()</span>
                )}
              </div>
              <div className="mt-1 font-semibold text-slate-100">{event.title}</div>
              <p className="mt-1.5 text-sm leading-6 text-slate-400">{event.summary}</p>
            </div>
            <div className={`grid size-7 shrink-0 place-items-center rounded-full ${isWaiting ? 'bg-amber-300/10 text-amber-200' : 'bg-emerald-300/10 text-emerald-200'}`}>
              {isWaiting ? <CircleDot size={14} /> : <Check size={14} />}
            </div>
            {index < trace.length - 1 && <div className="absolute left-[35px] top-14 h-4 w-px bg-white/8" />}
          </div>
        );
      })}

      {running && (
        <div className="flex items-center gap-3 rounded-2xl border border-cyan-300/12 bg-cyan-300/[0.04] p-4 text-sm text-cyan-100">
          <span className="agent-pulse size-2.5 rounded-full bg-cyan-300" />
          Agent is continuing the workflow…
        </div>
      )}
    </div>
  );
}
