'use client';

import React, { useState } from 'react';
import { MunicipalDirective } from '@/types/dashboard';
import {
  Sparkles,
  ShieldAlert,
  CheckCircle2,
  Send,
  Sliders,
  Clock,
  Flame,
  ArrowRight,
  Filter,
  Check,
} from 'lucide-react';

interface MunicipalDispatchFeedProps {
  directives: MunicipalDirective[];
  onApproveDirective: (directiveId: string) => void;
  onDispatchToAtcs: (directiveId: string) => void;
}

export const MunicipalDispatchFeed: React.FC<MunicipalDispatchFeedProps> = ({
  directives,
  onApproveDirective,
  onDispatchToAtcs,
}) => {
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'dispatched'>('all');
  const [justApprovedId, setJustApprovedId] = useState<string | null>(null);

  const filteredDirectives = directives.filter((d) => {
    if (filter === 'all') return true;
    return d.status === filter;
  });

  const handleApprove = (id: string) => {
    onApproveDirective(id);
    setJustApprovedId(id);
    setTimeout(() => setJustApprovedId(null), 2500);
  };

  return (
    <div className="command-card rounded-xl p-4 flex flex-col gap-3">
      {/* Header & Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1f293d] pb-2.5">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-sky-400" />
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-200">
            Municipal Dispatch Directives
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-950 text-sky-400 border border-sky-800">
            ATCS Uplink Active
          </span>
        </div>

        {/* Filter Badges */}
        <div className="flex items-center gap-1 text-[10px] font-mono">
          {(['all', 'pending', 'approved', 'dispatched'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-2 py-0.5 rounded capitalize transition-colors ${
                filter === tab
                  ? 'bg-slate-700 text-slate-100 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Feed List */}
      <div className="flex flex-col gap-2.5 max-h-[340px] overflow-y-auto pr-1">
        {filteredDirectives.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-slate-500">
            No directives matching filter &quot;{filter}&quot;.
          </div>
        ) : (
          filteredDirectives.map((d) => {
            const isLLM = d.mode === 'llm';
            const isApproved = d.status === 'approved';
            const isDispatched = d.status === 'dispatched';
            const isPending = d.status === 'pending';

            return (
              <div
                key={d.id}
                className={`p-3 rounded-lg border transition-all ${
                  isDispatched
                    ? 'bg-slate-900/40 border-[#1f293d] opacity-80'
                    : isApproved
                    ? 'bg-emerald-950/20 border-emerald-500/40'
                    : 'bg-[#0e1422] border-[#1f293d] hover:border-slate-600'
                }`}
              >
                {/* Directive Top Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    {/* Mode Badge: LLM vs Rules Fallback */}
                    {isLLM ? (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-sky-950/80 text-sky-300 border border-sky-500/40 shadow-[0_0_8px_rgba(14,165,233,0.2)]">
                        <Sparkles className="h-3 w-3 text-sky-400" />
                        LLM GENERATED
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950/80 text-amber-300 border border-amber-500/40 shadow-[0_0_8px_rgba(245,158,11,0.2)]">
                        <ShieldAlert className="h-3 w-3 text-amber-400" />
                        RULES FALLBACK
                      </span>
                    )}

                    <span className="text-[10px] font-mono text-slate-500">{d.id}</span>
                    <span className="text-[10px] font-mono text-slate-500">• {d.timestamp}</span>
                  </div>

                  {/* Confidence Badge */}
                  <div className="flex items-center gap-1 text-[10px] font-mono">
                    <span className="text-slate-400">Confidence:</span>
                    <span className="text-emerald-400 font-bold">
                      {Math.round(d.confidence * 100)}%
                    </span>
                  </div>
                </div>

                {/* Title & Action Metric */}
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <h4 className="text-xs font-bold text-slate-100 flex items-center gap-2">
                      {d.title}
                      {d.seconds > 0 && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#090d16] text-amber-300 border border-[#1f293d]">
                          +{d.seconds}s
                        </span>
                      )}
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#090d16] text-sky-300 border border-[#1f293d]">
                        Lane {d.lane}
                      </span>
                    </h4>
                  </div>

                  {/* Deterministic CO2 Saved Metric */}
                  <div className="text-right flex flex-col items-end min-w-[90px]">
                    <div className="text-[9px] font-mono text-slate-400 uppercase">
                      Est. CO₂ Saved
                    </div>
                    <div className="text-xs font-mono font-bold text-emerald-400 flex items-center gap-1">
                      <Flame className="h-3 w-3 text-emerald-500" />
                      {(d.estimatedCo2Saved_g / 1000).toFixed(2)} kg
                    </div>
                  </div>
                </div>

                {/* Rationale Text (<= 300 chars) */}
                <p className="text-[11px] text-slate-300 font-mono leading-relaxed bg-[#090d16]/60 p-2 rounded border border-[#1f293d]/50 mb-2.5">
                  {d.rationale}
                </p>

                {/* Action Footer */}
                <div className="flex items-center justify-between pt-1 border-t border-[#1f293d]/50">
                  <div className="text-[10px] font-mono text-slate-500 flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    <span>Target: {d.targetClass ? d.targetClass.toUpperCase() : 'ALL ARTERIAL CORRIDOR'}</span>
                  </div>

                  {/* Button State */}
                  {isPending && (
                    <button
                      onClick={() => handleApprove(d.id)}
                      className="flex items-center gap-1.5 px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-mono font-bold transition-all shadow-md cursor-pointer active:scale-95"
                    >
                      <Check className="h-3.5 w-3.5" />
                      APPROVE DIRECTIVE
                    </button>
                  )}

                  {isApproved && (
                    <button
                      onClick={() => onDispatchToAtcs(d.id)}
                      className="flex items-center gap-1.5 px-3 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-mono font-bold transition-all shadow-md cursor-pointer active:scale-95"
                    >
                      <Send className="h-3.5 w-3.5" />
                      DISPATCH TO ATCS
                    </button>
                  )}

                  {isDispatched && (
                    <span className="flex items-center gap-1.5 text-xs font-mono font-semibold text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Dispatched to Signal Controller
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
