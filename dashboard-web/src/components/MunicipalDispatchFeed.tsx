'use client';

import React, { useState, useMemo } from 'react';
import {
  Sparkles,
  ShieldAlert,
  Send,
  XCircle,
  Radio,
  Quote,
  CheckCircle2,
  Clock,
  Flame,
  ArrowRight,
  TrendingDown,
  Layers,
  Check,
} from 'lucide-react';

/* =========================================================================
   Data Contract (JSON Lines Schema) & TypeScript Types
   ========================================================================= */

export type VehicleTaxonomy = 'car' | 'motorcycle' | 'auto_rickshaw' | 'bus' | 'truck' | string;

export interface SignalAction {
  type: 'extend_green' | 'green_wave_priority' | 'heavy_vehicle_restriction' | 'no_action' | string;
  lane: 'N' | 'S' | 'E' | 'W' | 'All' | null;
  seconds: number;
  target_class: VehicleTaxonomy | null;
}

export interface Directive {
  id?: string;
  timestamp: string; // ISO 8601 string, e.g. "2026-10-16T11:15:00Z"
  intersection_id: string; // e.g. "junction_01"
  actions: SignalAction[];
  estimated_co2_saved_g: number;
  confidence: number; // 0.0 to 1.0
  rationale: string;
  mode: 'llm' | 'rules_fallback';
  status?: 'pending' | 'approved' | 'transmitted' | 'dispatched' | 'dismissed';
}

export interface MunicipalDispatchFeedProps {
  directives?: Directive[];
  onTransmit?: (directive: Directive) => void;
  onDismiss?: (directive: Directive) => void;
  onApproveDirective?: (id: string) => void;
  onDispatchToAtcs?: (id: string) => void;
  className?: string;
}

/* =========================================================================
   Realistic Mock Directives (Conforming Strictly to JSON Contract)
   ========================================================================= */

export const MOCK_DIRECTIVES: Directive[] = [
  {
    id: 'DIR-2026-1049',
    timestamp: '2026-10-16T11:15:00Z',
    intersection_id: 'junction_01',
    actions: [
      { type: 'extend_green', lane: 'N', seconds: 12, target_class: 'bus' },
      { type: 'heavy_vehicle_restriction', lane: 'E', seconds: 0, target_class: 'truck' },
    ],
    estimated_co2_saved_g: 340.5,
    confidence: 0.92,
    rationale:
      'Northbound corridor bus platoon accumulated 110s cumulative idle in Zone Z_1_2. Extending North green phase by 12s dissipates queue prior to cross-street peak.',
    mode: 'llm',
    status: 'pending',
  },
  {
    id: 'DIR-2026-1048',
    timestamp: '2026-10-16T11:13:30Z',
    intersection_id: 'junction_04',
    actions: [
      { type: 'green_wave_priority', lane: 'N', seconds: 10, target_class: 'bus' },
    ],
    estimated_co2_saved_g: 485.2,
    confidence: 0.95,
    rationale:
      'Downstream platoons approaching from MG Road arterial at 38 km/h. Signal phase offset adjusted +10s to prevent stop-and-go shockwaves across J04 and J05.',
    mode: 'llm',
    status: 'pending',
  },
  {
    id: 'DIR-2026-1047',
    timestamp: '2026-10-16T11:10:00Z',
    intersection_id: 'junction_01',
    actions: [
      { type: 'heavy_vehicle_restriction', lane: 'S', seconds: 15, target_class: 'truck' },
    ],
    estimated_co2_saved_g: 590.0,
    confidence: 0.88,
    rationale:
      'Fallback Rule triggered: Cumulative heavy vehicle idle duration > 90s in South stopline. Metering freight trucks to Ring Road perimeter bypass.',
    mode: 'rules_fallback',
    status: 'pending',
  },
  {
    id: 'DIR-2026-1046',
    timestamp: '2026-10-16T11:05:00Z',
    intersection_id: 'junction_04',
    actions: [
      { type: 'extend_green', lane: 'W', seconds: 5, target_class: 'auto_rickshaw' },
    ],
    estimated_co2_saved_g: 142.0,
    confidence: 0.84,
    rationale:
      'East-West minor approach queue cleared early. Truncating phase by 5s returns green cycle to saturated North arterial corridor.',
    mode: 'rules_fallback',
    status: 'pending',
  },
];

/* =========================================================================
   Helper: Format Relative Time ("Just now", "2m ago")
   ========================================================================= */

function getRelativeTime(isoString: string, nowMs: number | null): string {
  if (!nowMs) {
    return 'Just now';
  }
  try {
    const past = new Date(isoString).getTime();
    const diffSec = Math.max(0, Math.floor((nowMs - past) / 1000));

    if (diffSec < 45) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  } catch {
    return 'Just now';
  }
}

/* =========================================================================
   Helper: Action Chip Formatter
   ========================================================================= */

function formatActionChip(action: SignalAction): { label: string; details: string; icon: string } {
  switch (action.type) {
    case 'extend_green':
      return {
        label: `Extend Green: Lane ${action.lane || 'Corridor'} +${action.seconds}s`,
        details: action.target_class ? `Target: ${action.target_class}` : '',
        icon: '🟢',
      };
    case 'green_wave_priority':
      return {
        label: `Priority Wave: ${action.target_class ? action.target_class.toUpperCase() : 'Corridor'}`,
        details: action.seconds > 0 ? `+${action.seconds}s sync` : 'Offset tuned',
        icon: '🌊',
      };
    case 'heavy_vehicle_restriction':
      return {
        label: `Heavy Restriction: Lane ${action.lane || 'All'}`,
        details: action.target_class ? `${action.target_class}` : 'Freight divert',
        icon: '🛑',
      };
    default:
      return {
        label: `${action.type.replace(/_/g, ' ')}: Lane ${action.lane || 'All'}`,
        details: action.seconds ? `+${action.seconds}s` : '',
        icon: '⚙️',
      };
  }
}

/* =========================================================================
   Component: MunicipalDispatchFeed
   ========================================================================= */

export const MunicipalDispatchFeed: React.FC<MunicipalDispatchFeedProps> = ({
  directives: propDirectives,
  onTransmit,
  onDismiss,
  onApproveDirective,
  onDispatchToAtcs,
  className = '',
}) => {
  // Directives state (supports controlled or uncontrolled internal state)
  const [directives, setDirectives] = useState<Directive[]>(propDirectives || MOCK_DIRECTIVES);
  const [nowMs, setNowMs] = useState<number | null>(null);

  // Filter state: "All", "AI Directives", "Rule Fallbacks"
  const [activeFilter, setActiveFilter] = useState<'All' | 'AI Directives' | 'Rule Fallbacks'>('All');

  // Transmitting feedback state
  const [transmittingId, setTransmittingId] = useState<string | null>(null);

  // Defer Date.now() to client mount to allow prerendering
  React.useEffect(() => {
    setNowMs(Date.now());
    const interval = setInterval(() => setNowMs(Date.now()), 15000);
    return () => clearInterval(interval);
  }, []);

  // Sync prop changes if controlled
  React.useEffect(() => {
    if (propDirectives) {
      setDirectives(propDirectives);
    }
  }, [propDirectives]);

  // Filtered directives
  const visibleDirectives = useMemo(() => {
    return directives.filter((d) => {
      if (d.status === 'dismissed') return false;
      if (activeFilter === 'AI Directives') return d.mode === 'llm';
      if (activeFilter === 'Rule Fallbacks') return d.mode === 'rules_fallback';
      return true;
    });
  }, [directives, activeFilter]);

  // Transmit Handler
  const handleTransmit = (directive: Directive, id: string) => {
    setTransmittingId(id);

    setTimeout(() => {
      setDirectives((prev) =>
        prev.map((d, index) => {
          const itemKey = d.id || `${d.intersection_id}-${index}`;
          return itemKey === id ? { ...d, status: 'transmitted' } : d;
        })
      );
      setTransmittingId(null);
      if (onTransmit) onTransmit(directive);
      if (onDispatchToAtcs) onDispatchToAtcs(directive.id || id);
      if (onApproveDirective) onApproveDirective(directive.id || id);
    }, 700);
  };

  // Dismiss Handler
  const handleDismiss = (directive: Directive, id: string) => {
    setDirectives((prev) =>
      prev.map((d, index) => {
        const itemKey = d.id || `${d.intersection_id}-${index}`;
        return itemKey === id ? { ...d, status: 'dismissed' } : d;
      })
    );
    if (onDismiss) onDismiss(directive);
  };

  return (
    <div
      className={`command-card rounded-xl p-4 flex flex-col gap-3.5 border border-[#1f293d] bg-[#111827] shadow-2xl relative ${className}`}
    >
      {/* =====================================================================
          1. Feed Header
          ===================================================================== */}
      <div className="flex flex-col gap-2.5 border-b border-[#1f293d] pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          
          <div className="flex items-center gap-2">
            <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400">
              <Send className="h-4 w-4" />
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
              </span>
            </div>
            <div>
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-100 flex items-center gap-1.5">
                Municipal Dispatch Directives
              </h3>
            </div>
          </div>

          {/* Trigger Status Pill */}
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#0a1120] border border-sky-500/30 text-[10px] font-mono text-sky-300">
            <Radio className="h-3 w-3 text-sky-400 animate-pulse" />
            <span>Triggered every 30s or on choke event</span>
          </div>

        </div>

        {/* Filter Pills ("All", "AI Directives", "Rule Fallbacks") */}
        <div className="flex items-center gap-1.5 text-xs font-mono">
          {(['All', 'AI Directives', 'Rule Fallbacks'] as const).map((filter) => {
            const isActive = activeFilter === filter;
            const count = directives.filter((d) => {
              if (d.status === 'dismissed') return false;
              if (filter === 'AI Directives') return d.mode === 'llm';
              if (filter === 'Rule Fallbacks') return d.mode === 'rules_fallback';
              return true;
            }).length;

            return (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={`px-3 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                  isActive
                    ? 'bg-slate-700/80 text-slate-100 border border-slate-500/60 shadow-inner font-semibold'
                    : 'bg-[#090d16] text-slate-400 border border-[#1f293d] hover:border-slate-600 hover:text-slate-200'
                }`}
              >
                <span>{filter}</span>
                <span className="px-1 py-0.2 rounded text-[9px] bg-[#111827] text-slate-400 border border-[#1f293d]">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* =====================================================================
          2. Directives Feed List & Cards
          ===================================================================== */}
      <div className="flex flex-col gap-3 max-h-[460px] overflow-y-auto pr-1">
        {visibleDirectives.length === 0 ? (
          
          /* Empty State with Subtle Scanning Radar Animation */
          <div className="flex flex-col items-center justify-center p-10 rounded-xl bg-[#0a0f1d] border border-dashed border-[#1f293d] text-center my-2">
            
            {/* Subtle Scanning Radar Animation */}
            <div className="relative flex items-center justify-center h-20 w-20 mb-3">
              <div className="absolute inset-0 rounded-full border border-sky-500/20" />
              <div className="absolute inset-2 rounded-full border border-sky-500/30" />
              <div className="absolute inset-5 rounded-full border border-sky-500/40" />
              <div className="absolute inset-0 rounded-full border-t-2 border-r-2 border-sky-400 animate-spin" />
              <div className="h-3 w-3 rounded-full bg-sky-400 animate-ping" />
            </div>

            <p className="text-xs font-mono text-slate-300 font-semibold mb-1">
              Waiting for next dispatch cycle...
            </p>
            <p className="text-[11px] font-mono text-slate-500 max-w-xs">
              Evaluating every 30 twin-seconds or upon corridor queue accumulation breach.
            </p>
          </div>

        ) : (
          visibleDirectives.map((directive, index) => {
            const cardId = directive.id || `${directive.intersection_id}-${index}`;
            const isLLM = directive.mode === 'llm';
            const isTransmitted = directive.status === 'transmitted';
            const isTransmitting = transmittingId === cardId;
            const confidencePct = Math.round(directive.confidence * 100);

            return (
              <div
                key={cardId}
                className={`p-3.5 rounded-xl border transition-all relative overflow-hidden flex flex-col gap-2.5 ${
                  isTransmitted
                    ? 'bg-emerald-950/20 border-emerald-500/40'
                    : isLLM
                    ? 'bg-[#0c1222] border-indigo-900/50 hover:border-indigo-500/50'
                    : 'bg-[#15120c] border-amber-900/50 hover:border-amber-500/50'
                }`}
              >
                {/* Top Row: Source Badge, Intersection ID & Relative Timestamp */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  
                  <div className="flex items-center gap-2">
                    {/* Source Badge */}
                    {isLLM ? (
                      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-indigo-950 border border-indigo-500/60 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.25)]">
                        <Sparkles className="h-3 w-3 text-cyan-400" />
                        LLM OPTIMIZED
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-amber-950/90 border border-amber-500/60 text-yellow-300 shadow-[0_0_10px_rgba(245,158,11,0.2)]">
                        <ShieldAlert className="h-3 w-3 text-amber-400" />
                        RULES FALLBACK
                      </span>
                    )}

                    {/* Intersection ID */}
                    <span className="text-xs font-mono font-bold text-slate-200">
                      {directive.intersection_id}
                    </span>
                  </div>

                  {/* Relative Timestamp */}
                  <div className="flex items-center gap-1 text-[11px] font-mono text-slate-400">
                    <Clock className="h-3 w-3 text-slate-500" />
                    <span>{getRelativeTime(directive.timestamp, nowMs)}</span>
                    <span className="text-slate-600">•</span>
                    <span className="text-slate-500 text-[10px]">
                      {new Date(directive.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                </div>

                {/* Action Chips: Signal Actions display */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {directive.actions.map((act, aIdx) => {
                    const chip = formatActionChip(act);
                    return (
                      <div
                        key={aIdx}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#090d16] border border-[#1f293d] text-[11px] font-mono font-semibold text-slate-200 shadow-sm"
                      >
                        <span className="text-xs">{chip.icon}</span>
                        <span>{chip.label}</span>
                        {chip.details && (
                          <span className="text-[10px] text-slate-400 font-normal">
                            ({chip.details})
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Rationale Box: Clean Quote Styling */}
                <div className="relative rounded-lg bg-[#090d16]/75 border-l-2 border-sky-500/70 p-2.5 text-[11px] font-mono text-slate-300 leading-relaxed italic flex items-start gap-2">
                  <Quote className="h-3.5 w-3.5 text-sky-400/80 shrink-0 mt-0.5 not-italic" />
                  <p className="flex-1 not-italic text-slate-300">{directive.rationale}</p>
                </div>

                {/* Impact Metrics: Est. CO2 Saved & Confidence Bar */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-[#1f293d]/50">
                  
                  {/* Metric: Est. CO2 Saved */}
                  <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#090d16] border border-[#1f293d] text-xs font-mono">
                    <span className="text-slate-400 flex items-center gap-1">
                      <Flame className="h-3.5 w-3.5 text-emerald-400" />
                      Est. CO₂ Saved:
                    </span>
                    <span className="font-bold text-emerald-400 tabular-nums">
                      +{directive.estimated_co2_saved_g.toFixed(1)} g
                    </span>
                  </div>

                  {/* Metric: Confidence with Progress Bar */}
                  <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#090d16] border border-[#1f293d] text-xs font-mono">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400">Confidence:</span>
                      <span className="font-bold text-cyan-300 tabular-nums">
                        {confidencePct}%
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-20 h-1.5 bg-[#1a2333] rounded-full overflow-hidden ml-2">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-500"
                        style={{ width: `${confidencePct}%` }}
                      />
                    </div>
                  </div>

                </div>

                {/* Operator Controls: Transmit CTA & Dismiss */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  
                  {isTransmitted ? (
                    <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 font-semibold px-2 py-1 rounded bg-emerald-950/40 border border-emerald-500/30 w-full justify-center">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Transmitted to ATCS Signal Controller • Phase Queued</span>
                    </div>
                  ) : (
                    <>
                      {/* Dismiss / Override Button */}
                      <button
                        onClick={() => handleDismiss(directive, cardId)}
                        className="px-3 py-1.5 rounded-lg bg-[#090d16] border border-[#1f293d] hover:border-rose-500/50 hover:bg-rose-950/20 text-slate-400 hover:text-rose-300 text-xs font-mono font-medium transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <XCircle className="h-3.5 w-3.5 text-rose-400" />
                        <span>Dismiss / Override</span>
                      </button>

                      {/* Transmit to ATCS Primary CTA Button (Pulse Animation) */}
                      <button
                        onClick={() => handleTransmit(directive, cardId)}
                        disabled={isTransmitting}
                        className="relative group/cta flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-mono font-bold transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_20px_rgba(16,185,129,0.5)] cursor-pointer active:scale-95 disabled:opacity-50"
                      >
                        {/* Pulse Ring Animation */}
                        <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-300"></span>
                        </span>

                        <Send className={`h-3.5 w-3.5 ${isTransmitting ? 'animate-bounce' : ''}`} />
                        <span>
                          {isTransmitting
                            ? 'Transmitting Uplink...'
                            : 'Transmit to ATCS Signal Controller'}
                        </span>
                      </button>
                    </>
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
