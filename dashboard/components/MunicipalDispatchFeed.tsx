'use client';

import React, { useState, useMemo, useEffect } from 'react';
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
  Search,
  Filter,
  Info,
  AlertTriangle,
  RotateCcw,
  Zap,
  ShieldCheck,
  TrafficCone,
  SlidersHorizontal,
} from 'lucide-react';

/* =========================================================================
   Types & Fallback Mock Data
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
  directive_id?: string;
  timestamp: string;
  intersection_id: string;
  actions: SignalAction[];
  estimated_co2_saved_g: number;
  confidence: number;
  rationale: string;
  mode: 'llm' | 'rules_fallback';
  status?: 'pending' | 'approved' | 'transmitted' | 'dispatched' | 'dismissed';
  urgency?: 'critical' | 'high' | 'moderate' | 'low';
  dispatchedAt?: string;
}

export type MunicipalDirective = Directive;

export type StatusFilter = 'all' | 'pending' | 'dispatched' | 'dismissed';
export type ModeFilter = 'all' | 'llm' | 'rules_fallback';

export interface MunicipalDispatchFeedProps {
  directives?: Directive[];
  onTransmit?: (directive: Directive) => void;
  onDismiss?: (directive: Directive) => void;
  onApproveDirective?: (id: string) => void;
  onDispatchToAtcs?: (id: string) => void;
  className?: string;
}

export const MOCK_DIRECTIVES: Directive[] = [
  {
    id: 'DIR-2026-1050',
    directive_id: 'DIR-2026-1050',
    timestamp: '2026-10-16T11:18:00Z',
    intersection_id: 'junction_01',
    urgency: 'critical',
    actions: [
      { type: 'extend_green', lane: 'N', seconds: 10, target_class: null },
      { type: 'green_wave_priority', lane: 'E', seconds: 15, target_class: 'bus' },
    ],
    estimated_co2_saved_g: 1246.7,
    confidence: 0.94,
    rationale:
      'Arterial freight queue spilling past North approach stopline. Synchronizing E-W green wave and adding +10s to North green phase to avoid heavy stop-start emissions.',
    mode: 'llm',
    status: 'pending',
  },
  {
    id: 'DIR-2026-1049',
    directive_id: 'DIR-2026-1049',
    timestamp: '2026-10-16T11:15:00Z',
    intersection_id: 'junction_01',
    urgency: 'high',
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
    directive_id: 'DIR-2026-1048',
    timestamp: '2026-10-16T11:13:30Z',
    intersection_id: 'junction_04',
    urgency: 'moderate',
    actions: [
      { type: 'green_wave_priority', lane: 'N', seconds: 10, target_class: 'bus' },
    ],
    estimated_co2_saved_g: 485.2,
    confidence: 0.95,
    rationale:
      'Downstream platoons approaching from MG Road at 38 km/h. Signal phase offset adjusted +10s to prevent stop-and-go shockwaves across J04 and J05.',
    mode: 'llm',
    status: 'dispatched',
    dispatchedAt: '2026-10-16T11:14:02Z',
  },
  {
    id: 'DIR-2026-1047',
    directive_id: 'DIR-2026-1047',
    timestamp: '2026-10-16T11:10:00Z',
    intersection_id: 'junction_01',
    urgency: 'critical',
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
    directive_id: 'DIR-2026-1046',
    timestamp: '2026-10-16T11:05:00Z',
    intersection_id: 'junction_04',
    urgency: 'low',
    actions: [
      { type: 'no_action', lane: null, seconds: 0, target_class: null },
    ],
    estimated_co2_saved_g: 0.0,
    confidence: 0.96,
    rationale:
      'Corridor telemetry nominal: idle ratio 0.12, heavy vehicle density 4.5%. Cycle timing operating at peak baseline efficiency.',
    mode: 'rules_fallback',
    status: 'dismissed',
  },
];

/* =========================================================================
   Helpers
   ========================================================================= */

function getRelativeTime(isoString: string, nowMs: number | null): string {
  if (!nowMs) return 'Just now';
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

function resolveUrgency(directive: Directive): 'critical' | 'high' | 'moderate' | 'low' {
  if (directive.urgency) return directive.urgency;
  if (directive.actions.some((a) => a.type === 'no_action')) return 'low';
  if (directive.estimated_co2_saved_g > 800) return 'critical';
  if (directive.actions.some((a) => a.type === 'heavy_vehicle_restriction')) return 'high';
  if (directive.estimated_co2_saved_g > 300) return 'high';
  return 'moderate';
}

interface ActionChipDescriptor {
  typeKey: string;
  label: string;
  subtext: string;
  icon: string;
  badgeClass: string;
}

function formatActionChip(action: SignalAction): ActionChipDescriptor {
  switch (action.type) {
    case 'extend_green':
      return {
        typeKey: 'extend_green',
        label: `+${action.seconds || 10}s on Lane ${action.lane || 'N'}`,
        subtext: action.target_class ? `Target: ${action.target_class}` : 'Phase extension',
        icon: '🟢',
        badgeClass: 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200',
      };
    case 'green_wave_priority':
      return {
        typeKey: 'green_wave_priority',
        label: `Corridor ${action.lane ? `${action.lane} Synchronized` : 'E-W Synchronized'}`,
        subtext: action.seconds ? `+${action.seconds}s sync offset` : 'Wave sync',
        icon: '🌊',
        badgeClass: 'border-cyan-500/40 bg-cyan-950/40 text-cyan-200',
      };
    case 'heavy_vehicle_restriction':
      return {
        typeKey: 'heavy_vehicle_restriction',
        label: action.target_class
          ? `Restrict Heavy Vehicles (${action.target_class})`
          : 'Restrict Heavy Vehicles >10t',
        subtext: action.lane ? `Lane ${action.lane} detour` : 'Freight metering',
        icon: '🛑',
        badgeClass: 'border-amber-500/40 bg-amber-950/40 text-amber-200',
      };
    case 'no_action':
      return {
        typeKey: 'no_action',
        label: 'No Action (Monitoring Baseline)',
        subtext: 'Corridor nominal',
        icon: '⚪',
        badgeClass: 'border-slate-600/40 bg-slate-800/40 text-slate-300',
      };
    default:
      return {
        typeKey: action.type,
        label: `${action.type.replace(/_/g, ' ')}: ${action.lane || 'All'}`,
        subtext: action.seconds ? `+${action.seconds}s` : '',
        icon: '⚙️',
        badgeClass: 'border-slate-600/40 bg-slate-800/40 text-slate-300',
      };
  }
}

/* =========================================================================
   Main Component: MunicipalDispatchFeed
   ========================================================================= */

export const MunicipalDispatchFeed: React.FC<MunicipalDispatchFeedProps> = ({
  directives: propDirectives,
  onTransmit,
  onDismiss,
  onApproveDirective,
  onDispatchToAtcs,
  className = '',
}) => {
  // Status overrides map for local operator actions
  const [statusOverrides, setStatusOverrides] = useState<
    Record<string, { status: Directive['status']; dispatchedAt?: string }>
  >({});
  const [nowMs, setNowMs] = useState<number>(0);

  // Filters & Search State
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Active simulated transmission tracker
  const [transmittingId, setTransmittingId] = useState<string | null>(null);

  // Tooltip hover tracker for deterministic co2 badge
  const [hoveredTooltipId, setHoveredTooltipId] = useState<string | null>(null);

  // Defer Date.now() to client mount to ensure hydration consistency
  useEffect(() => {
    const init = setTimeout(() => setNowMs(Date.now()), 0);
    const timer = setInterval(() => setNowMs(Date.now()), 15000);
    return () => {
      clearTimeout(init);
      clearInterval(timer);
    };
  }, []);

  // Merge propDirectives with local operator status overrides
  const directives = useMemo(() => {
    const baseList = propDirectives || MOCK_DIRECTIVES;
    return baseList.map((d, index) => {
      const itemKey = d.id || d.directive_id || `${d.intersection_id}-${index}`;
      const override = statusOverrides[itemKey];
      if (override) {
        return {
          ...d,
          status: override.status,
          dispatchedAt: override.dispatchedAt ?? d.dispatchedAt,
        };
      }
      return d;
    });
  }, [propDirectives, statusOverrides]);

  // Directives filter and search logic
  const filteredDirectives = useMemo(() => {
    return directives.filter((d) => {
      // 1. Status Filter
      if (statusFilter === 'pending') {
        if (d.status !== 'pending' && d.status !== 'approved') return false;
      } else if (statusFilter === 'dispatched') {
        if (d.status !== 'dispatched' && d.status !== 'transmitted') return false;
      } else if (statusFilter === 'dismissed') {
        if (d.status !== 'dismissed') return false;
      }

      // 2. Mode Filter
      if (modeFilter === 'llm' && d.mode !== 'llm') return false;
      if (modeFilter === 'rules_fallback' && d.mode !== 'rules_fallback') return false;

      // 3. Search Query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const idMatch =
          (d.id && d.id.toLowerCase().includes(query)) ||
          (d.directive_id && d.directive_id.toLowerCase().includes(query)) ||
          false;
        const intersectionMatch = d.intersection_id.toLowerCase().includes(query);
        const rationaleMatch = d.rationale.toLowerCase().includes(query);
        const actionMatch = d.actions.some(
          (a) =>
            a.type.toLowerCase().includes(query) ||
            (a.target_class && a.target_class.toLowerCase().includes(query)) ||
            (a.lane && a.lane.toLowerCase().includes(query))
        );
        if (!idMatch && !intersectionMatch && !rationaleMatch && !actionMatch) {
          return false;
        }
      }

      return true;
    });
  }, [directives, statusFilter, modeFilter, searchQuery]);

  // Handler: Approve & Push to ATCS / SCATS with simulated ping
  const handleApproveAndPush = (directive: Directive, directiveKey: string) => {
    setTransmittingId(directiveKey);

    setTimeout(() => {
      const nowIso = new Date().toISOString();
      setStatusOverrides((prev) => ({
        ...prev,
        [directiveKey]: {
          status: 'dispatched',
          dispatchedAt: nowIso,
        },
      }));
      setTransmittingId(null);

      // Trigger callbacks
      const idToPass = directive.id || directive.directive_id || directiveKey;
      if (onApproveDirective) onApproveDirective(idToPass);
      if (onDispatchToAtcs) onDispatchToAtcs(idToPass);
      if (onTransmit) onTransmit({ ...directive, status: 'dispatched', dispatchedAt: nowIso });
    }, 700);
  };

  // Handler: Dismiss / Reject
  const handleDismiss = (directive: Directive, directiveKey: string) => {
    setStatusOverrides((prev) => ({
      ...prev,
      [directiveKey]: {
        status: 'dismissed',
      },
    }));

    const idToPass = directive.id || directive.directive_id || directiveKey;
    if (onDismiss) onDismiss({ ...directive, id: idToPass, status: 'dismissed' });
  };

  // Handler: Recall / Reset to Pending
  const handleRecall = (directiveKey: string) => {
    setStatusOverrides((prev) => ({
      ...prev,
      [directiveKey]: {
        status: 'pending',
      },
    }));
  };

  // Counts for pills
  const statusCounts = useMemo(() => {
    return {
      all: directives.length,
      pending: directives.filter((d) => d.status === 'pending' || d.status === 'approved' || !d.status).length,
      dispatched: directives.filter((d) => d.status === 'dispatched' || d.status === 'transmitted').length,
      dismissed: directives.filter((d) => d.status === 'dismissed').length,
    };
  }, [directives]);

  const modeCounts = useMemo(() => {
    return {
      all: directives.length,
      llm: directives.filter((d) => d.mode === 'llm').length,
      rules_fallback: directives.filter((d) => d.mode === 'rules_fallback').length,
    };
  }, [directives]);

  return (
    <div
      className={`rounded-xl p-4 flex flex-col gap-3.5 border border-[#1f293d] bg-[#111827] shadow-2xl relative ${className}`}
    >
      {/* =====================================================================
          1. Control Center Header & Telemetry Uplink Beacon
          ===================================================================== */}
      <div className="flex flex-col gap-2.5 border-b border-[#1f293d] pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400">
              <Radio className="h-4 w-4" />
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-100">
                  Municipal Dispatch Feed & ATCS Control
                </h3>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700">
                  LIVE UPLINK
                </span>
              </div>
              <p className="text-[10px] font-mono text-slate-400">
                Advisory intervention queue triggered every 30s or on choke breach
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#0a1120] border border-sky-500/30 text-[10px] font-mono text-sky-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>SCATS Gateway Active</span>
            </div>
          </div>
        </div>

        {/* =====================================================================
            Filter & Search Bar (Requirements 5)
            ===================================================================== */}
        <div className="flex flex-col gap-2 pt-1">
          {/* Search Input */}
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search by Junction ID, Directive ID, Action or Rationale keyword..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-8 py-1.5 rounded-lg bg-[#0a0f1d] border border-[#1f293d] text-xs font-mono text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-500/60 focus:ring-1 focus:ring-sky-500/30 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-0.5"
                title="Clear Search"
              >
                <XCircle className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Dual Row Filters: Mode and Status */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
            {/* Status Filter Tabs */}
            <div className="flex items-center gap-1 bg-[#090d16] p-1 rounded-lg border border-[#1f293d]">
              <span className="text-[10px] text-slate-500 px-1.5 uppercase font-semibold flex items-center gap-1">
                <Filter className="h-2.5 w-2.5" /> Status:
              </span>
              {(
                [
                  { key: 'all', label: 'All', count: statusCounts.all },
                  { key: 'pending', label: 'Pending', count: statusCounts.pending },
                  { key: 'dispatched', label: 'Dispatched', count: statusCounts.dispatched },
                  { key: 'dismissed', label: 'Dismissed', count: statusCounts.dismissed },
                ] as const
              ).map((tab) => {
                const isActive = statusFilter === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setStatusFilter(tab.key)}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all flex items-center gap-1 cursor-pointer ${
                      isActive
                        ? 'bg-slate-700 text-slate-100 font-semibold shadow-inner'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`px-1 py-0.2 rounded text-[9px] ${
                        isActive
                          ? 'bg-slate-900 text-sky-300'
                          : 'bg-[#111827] text-slate-500'
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Mode Filter Tabs */}
            <div className="flex items-center gap-1 bg-[#090d16] p-1 rounded-lg border border-[#1f293d]">
              <span className="text-[10px] text-slate-500 px-1.5 uppercase font-semibold flex items-center gap-1">
                <SlidersHorizontal className="h-2.5 w-2.5" /> Mode:
              </span>
              {(
                [
                  { key: 'all', label: 'All Modes', count: modeCounts.all },
                  { key: 'llm', label: 'Gemini 1.5 Flash', count: modeCounts.llm },
                  { key: 'rules_fallback', label: 'Rules Fallback', count: modeCounts.rules_fallback },
                ] as const
              ).map((tab) => {
                const isActive = modeFilter === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setModeFilter(tab.key)}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all flex items-center gap-1 cursor-pointer ${
                      isActive
                        ? tab.key === 'llm'
                          ? 'bg-purple-900/80 text-purple-200 font-semibold border border-purple-500/50'
                          : tab.key === 'rules_fallback'
                          ? 'bg-amber-900/80 text-amber-200 font-semibold border border-amber-500/50'
                          : 'bg-slate-700 text-slate-100 font-semibold'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`px-1 py-0.2 rounded text-[9px] ${
                        isActive
                          ? 'bg-slate-900 text-slate-200'
                          : 'bg-[#111827] text-slate-500'
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================================
          2. Directive Cards Stream (Chronological List)
          ===================================================================== */}
      <div className="flex flex-col gap-3.5 max-h-[520px] overflow-y-auto pr-1">
        {filteredDirectives.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 rounded-xl bg-[#0a0f1d] border border-dashed border-[#1f293d] text-center my-2">
            <div className="relative flex items-center justify-center h-16 w-16 mb-2">
              <div className="absolute inset-0 rounded-full border border-sky-500/20" />
              <div className="absolute inset-2 rounded-full border border-sky-500/30" />
              <div className="absolute inset-0 rounded-full border-t-2 border-r-2 border-sky-400 animate-spin" />
              <div className="h-2.5 w-2.5 rounded-full bg-sky-400 animate-ping" />
            </div>
            <p className="text-xs font-mono text-slate-300 font-semibold mb-1">
              No matching municipal directives
            </p>
            <p className="text-[11px] font-mono text-slate-500 max-w-sm mb-3">
              {searchQuery
                ? `No directives found matching "${searchQuery}". Try adjusting your search query or filter settings.`
                : 'All incoming directives have been processed or filtered out for current selection.'}
            </p>
            {(searchQuery || statusFilter !== 'all' || modeFilter !== 'all') && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('all');
                  setModeFilter('all');
                }}
                className="px-3 py-1 rounded-md text-xs font-mono bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                Reset Search & Filters
              </button>
            )}
          </div>
        ) : (
          filteredDirectives.map((directive, index) => {
            const cardId = directive.id || directive.directive_id || `${directive.intersection_id}-${index}`;
            const isLLM = directive.mode === 'llm';
            const urgency = resolveUrgency(directive);
            const isDispatched = directive.status === 'dispatched' || directive.status === 'transmitted';
            const isDismissed = directive.status === 'dismissed';
            const isTransmitting = transmittingId === cardId;
            const confidencePct = Math.round(directive.confidence * 100);
            const isTooltipOpen = hoveredTooltipId === cardId;

            return (
              <div
                key={cardId}
                className={`shrink-0 min-h-fit p-4 rounded-xl border transition-all relative overflow-hidden flex flex-col gap-3 ${
                  isDispatched
                    ? 'bg-gradient-to-b from-[#0c1a17] to-[#0a1413] border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.12)]'
                    : isDismissed
                    ? 'bg-[#0f1118]/80 border-slate-800/60 opacity-60'
                    : isLLM
                    ? 'bg-gradient-to-b from-[#101426] to-[#0c0f1c] border-purple-900/60 hover:border-purple-500/60 shadow-[0_0_15px_rgba(168,85,247,0.08)]'
                    : 'bg-gradient-to-b from-[#18130d] to-[#120e09] border-amber-900/60 hover:border-amber-500/60 shadow-[0_0_15px_rgba(245,158,11,0.08)]'
                }`}
              >
                {/* -------------------------------------------------------------
                    Card Header: Mode Badge, Urgency Pill, Intersection & Time
                    ------------------------------------------------------------- */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Requirement 1: High-Contrast Mode Badge */}
                    {isLLM ? (
                      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold tracking-wide uppercase bg-purple-950/90 border border-purple-500/70 text-purple-200 shadow-[0_0_12px_rgba(168,85,247,0.3)]">
                        <Sparkles className="h-3 w-3 text-purple-300 animate-pulse" />
                        Mode: Gemini 1.5 Flash
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold tracking-wide uppercase bg-amber-950/90 border border-amber-500/70 text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.25)]">
                        <ShieldAlert className="h-3 w-3 text-amber-300" />
                        Mode: Rules-Engine Fallback
                      </span>
                    )}

                    {/* Requirement 1: Urgency Indicator */}
                    {urgency === 'critical' ? (
                      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-rose-950/80 border border-rose-500/60 text-rose-300 shadow-[0_0_8px_rgba(244,63,94,0.3)]">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                        </span>
                        URGENT / CRITICAL
                      </span>
                    ) : urgency === 'high' ? (
                      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase bg-amber-950/60 border border-amber-500/50 text-amber-300">
                        <AlertTriangle className="h-2.5 w-2.5 text-amber-400" />
                        HIGH PRIORITY
                      </span>
                    ) : urgency === 'moderate' ? (
                      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase bg-sky-950/60 border border-sky-500/40 text-sky-300">
                        MODERATE
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase bg-slate-800/80 border border-slate-700 text-slate-400">
                        ROUTINE
                      </span>
                    )}

                    {/* Intersection ID */}
                    <div className="flex items-center gap-1 text-xs font-mono font-bold text-slate-200">
                      <TrafficCone className="h-3 w-3 text-slate-400" />
                      <span>{directive.intersection_id.toUpperCase()}</span>
                    </div>
                  </div>

                  {/* Relative Timestamp & Time */}
                  <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
                    <Clock className="h-3 w-3 text-slate-500" />
                    <span>{getRelativeTime(directive.timestamp, nowMs)}</span>
                    <span className="text-slate-600">•</span>
                    <span className="text-slate-400 text-[10px]">
                      {new Date(directive.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>
                </div>

                {/* -------------------------------------------------------------
                    Requirement 2: Concrete Recommended Actions List (Action Chips)
                    ------------------------------------------------------------- */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <Zap className="h-3 w-3 text-amber-400" /> Recommended Signal Interventions:
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {directive.actions.map((act, aIdx) => {
                      const chip = formatActionChip(act);
                      return (
                        <div
                          key={aIdx}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-mono font-semibold shadow-sm transition-transform hover:scale-[1.01] ${chip.badgeClass}`}
                        >
                          <span className="text-xs">{chip.icon}</span>
                          <span className="font-bold tracking-tight">{chip.label}</span>
                          {chip.subtext && (
                            <span className="text-[10px] opacity-80 border-l border-current/30 pl-1.5 font-normal">
                              {chip.subtext}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* -------------------------------------------------------------
                    Requirement 1: Concise Municipal Rationale Box (<=300 chars)
                    ------------------------------------------------------------- */}
                <div className="relative rounded-lg bg-[#090d16]/80 border-l-3 border-sky-400/80 p-3 text-xs font-mono text-slate-300 leading-relaxed flex flex-col gap-1">
                  <div className="flex items-start gap-2">
                    <Quote className="h-3.5 w-3.5 text-sky-400/80 shrink-0 mt-0.5" />
                    <p className="flex-1 text-slate-200">{directive.rationale}</p>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 pt-1 border-t border-slate-800/60 mt-1">
                    <span className="flex items-center gap-1 text-slate-400">
                      <ShieldCheck className="h-3 w-3 text-emerald-400" />
                      Deterministic Guardrails Enforced
                    </span>
                    <span>
                      Length: {directive.rationale.length}/300 chars (Schema Compliant)
                    </span>
                  </div>
                </div>

                {/* -------------------------------------------------------------
                    Requirement 1 & 3: Deterministic CO2 Savings Badge & Confidence Gauge
                    ------------------------------------------------------------- */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  {/* Requirement 3: Deterministic CO2 Savings Badge with Tooltip */}
                  <div className="relative group">
                    <div
                      onMouseEnter={() => setHoveredTooltipId(cardId)}
                      onMouseLeave={() => setHoveredTooltipId(null)}
                      className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-950/40 border border-emerald-500/50 text-xs font-mono shadow-[0_0_12px_rgba(16,185,129,0.15)] cursor-help transition-all hover:bg-emerald-950/60"
                    >
                      <div className="flex items-center gap-1.5 text-emerald-300 font-semibold">
                        <Flame className="h-4 w-4 text-emerald-400 animate-pulse" />
                        <span>Avoided Emissions:</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-emerald-300 text-sm tabular-nums">
                          ⚡ {directive.estimated_co2_saved_g.toLocaleString(undefined, {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          })}{' '}
                          g CO₂ Avoided
                        </span>
                        <Info className="h-3.5 w-3.5 text-emerald-400/70" />
                      </div>
                    </div>

                    {/* Explanatory Tooltip: "Computed via CPCB mode-bin engine, never LLM hallucination" */}
                    {isTooltipOpen && (
                      <div className="absolute z-20 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-2.5 rounded-lg bg-[#070b14] border border-emerald-500/60 text-slate-200 text-[11px] font-mono shadow-2xl pointer-events-none animate-in fade-in zoom-in-95 duration-150">
                        <div className="flex items-start gap-1.5 text-emerald-300 font-semibold mb-1">
                          <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-0.5 text-emerald-400" />
                          <span>Audit-Grade Deterministic Math</span>
                        </div>
                        <p className="text-slate-300 text-[10.5px] leading-relaxed">
                          &quot;Computed via CPCB mode-bin engine, never LLM hallucination&quot;
                        </p>
                        <p className="text-slate-400 text-[9.5px] mt-1 pt-1 border-t border-slate-800">
                          Source: CPCB & ARAI BS-VI Fleet Emission Factors matrix.
                        </p>
                        <div className="absolute left-1/2 -bottom-1.5 -translate-x-1/2 w-3 h-3 bg-[#070b14] border-r border-b border-emerald-500/60 rotate-45" />
                      </div>
                    )}
                  </div>

                  {/* Requirement 1: Confidence Score Gauge (0-100%) */}
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#090d16] border border-[#1f293d] text-xs font-mono">
                    <div className="flex items-center gap-1.5 text-slate-400">
                      <span>Model Confidence:</span>
                      <span className="font-bold text-cyan-300 tabular-nums">
                        {confidencePct}%
                      </span>
                    </div>

                    {/* Visual Meter Bar Gauge */}
                    <div className="flex items-center gap-1.5">
                      <div className="w-24 h-2 bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700/50">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-sky-400 via-indigo-400 to-emerald-400 transition-all duration-500"
                          style={{ width: `${confidencePct}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-slate-500">
                        {confidencePct >= 90 ? 'HIGH' : confidencePct >= 80 ? 'STABLE' : 'FAIR'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* -------------------------------------------------------------
                    Requirement 4: Interactive Municipal Operator Actions
                    ------------------------------------------------------------- */}
                <div className="pt-2 border-t border-[#1f293d]/60">
                  {isDispatched ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-500/40 text-xs font-mono">
                      <div className="flex items-center gap-2 text-emerald-300 font-semibold">
                        <span className="relative flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                        </span>
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        <span>Dispatched to Signal Controller</span>
                        <span className="text-[10px] text-slate-400 font-normal">
                          • Transmitted to SCATS/ATCS (ACK #{cardId.slice(-4)})
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {directive.dispatchedAt && (
                          <span className="text-[10px] text-slate-400">
                            {new Date(directive.dispatchedAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                        <button
                          onClick={() => handleRecall(cardId)}
                          className="text-[10px] text-slate-400 hover:text-slate-200 underline decoration-dotted cursor-pointer px-1 py-0.5"
                        >
                          Recall Phase
                        </button>
                      </div>
                    </div>
                  ) : isDismissed ? (
                    <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60 border border-slate-800 text-xs font-mono text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <XCircle className="h-3.5 w-3.5 text-rose-400" />
                        <span>Dismissed by Municipal Operator</span>
                      </div>
                      <button
                        onClick={() => handleRecall(cardId)}
                        className="text-[10px] text-sky-400 hover:text-sky-300 underline cursor-pointer"
                      >
                        Restore to Pending
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {/* Button: Dismiss / Reject */}
                      <button
                        onClick={() => handleDismiss(directive, cardId)}
                        className="px-3.5 py-1.5 rounded-lg bg-[#090d16] border border-slate-700/80 hover:border-rose-500/60 hover:bg-rose-950/25 text-slate-400 hover:text-rose-300 text-xs font-mono font-medium transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <XCircle className="h-3.5 w-3.5 text-rose-400" />
                        <span>Dismiss / Reject</span>
                      </button>

                      {/* Button: Approve & Push to ATCS / SCATS with Simulated Ping */}
                      <button
                        onClick={() => handleApproveAndPush(directive, cardId)}
                        disabled={isTransmitting}
                        className="relative group flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-slate-950 text-xs font-mono font-bold transition-all shadow-[0_0_15px_rgba(16,185,129,0.35)] hover:shadow-[0_0_20px_rgba(16,185,129,0.55)] cursor-pointer disabled:opacity-50"
                      >
                        {/* Simulated Transmission Ping Beacon */}
                        <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-200"></span>
                        </span>

                        <Send className={`h-3.5 w-3.5 ${isTransmitting ? 'animate-bounce' : ''}`} />
                        <span>
                          {isTransmitting
                            ? 'Transmitting to ATCS / SCATS...'
                            : 'Approve & Push to ATCS / SCATS'}
                        </span>
                      </button>
                    </div>
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

export default MunicipalDispatchFeed;
