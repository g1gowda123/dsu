'use client';

import React from 'react';
import {
  Car,
  CloudLightning,
  AlertTriangle,
  Flame,
  Gauge,
  TrendingUp,
  MapPin,
  Clock,
  ArrowUpRight,
  ShieldAlert,
} from 'lucide-react';
import { TelemetryPoint } from '@/types/dashboard';

interface MetricKpiGridProps {
  currentTelemetry: TelemetryPoint;
  totalTracked: number;
  cumulativeCo2: number;
  idleShare: number;
  heavyStopEvents: number;
  topChokePoint: {
    zoneId: string;
    label: string;
    idleMins: number;
    intensity: string;
  };
}

export const MetricKpiGrid: React.FC<MetricKpiGridProps> = ({
  currentTelemetry,
  totalTracked,
  cumulativeCo2,
  idleShare,
  heavyStopEvents,
  topChokePoint,
}) => {
  const carCount = Math.round(totalTracked * 0.32);
  const bikeCount = Math.round(totalTracked * 0.40);
  const autoCount = Math.round(totalTracked * 0.15);
  const busCount = Math.round(totalTracked * 0.08);
  const truckCount = Math.max(0, totalTracked - carCount - bikeCount - autoCount - busCount);

  const busStops = Math.round(heavyStopEvents * 0.64);
  const truckStops = Math.max(0, heavyStopEvents - busStops);

  const isIdleBreached = idleShare >= 40.0;
  const isCriticalChoke = topChokePoint.intensity === 'critical';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 w-full">
      
      {/* CARD 1: Total Tracked Vehicles */}
      <div className="command-card rounded-lg p-3.5 relative overflow-hidden group">
        <div className="absolute top-0 right-0 h-16 w-16 bg-sky-500/5 rounded-bl-full pointer-events-none transition-transform group-hover:scale-110" />
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
          <span className="font-mono uppercase tracking-wider text-[11px] text-slate-400 flex items-center gap-1.5">
            <Car className="h-3.5 w-3.5 text-sky-400" />
            Tracked Vehicles
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-950/60 text-sky-400 border border-sky-800/40">
            ByteTrack
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold font-mono tracking-tight text-slate-100 tabular-nums">
            {totalTracked}
          </span>
          <span className="text-xs text-slate-400">active units</span>
        </div>
        {/* Class Breakdown Mini-Badges */}
        <div className="mt-2.5 pt-2 border-t border-[#1f293d] flex items-center justify-between text-[10px] text-slate-400 font-mono">
          <span title="Car">🚗 {carCount}</span>
          <span title="Motorcycle">🛵 {bikeCount}</span>
          <span title="Auto-Rickshaw">🛺 {autoCount}</span>
          <span title="Bus">🚌 {busCount}</span>
          <span title="Truck">🚛 {truckCount}</span>
        </div>
      </div>

      {/* CARD 2: Cumulative CO2 */}
      <div className="command-card rounded-lg p-3.5 relative overflow-hidden group">
        <div className="absolute top-0 right-0 h-16 w-16 bg-rose-500/5 rounded-bl-full pointer-events-none transition-transform group-hover:scale-110" />
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
          <span className="font-mono uppercase tracking-wider text-[11px] text-slate-400 flex items-center gap-1.5">
            <Flame className="h-3.5 w-3.5 text-rose-500" />
            Cumulative CO₂
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-950/60 text-rose-400 border border-rose-800/40">
            Deterministic
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold font-mono tracking-tight text-slate-100 tabular-nums">
            {cumulativeCo2.toFixed(1)}
          </span>
          <span className="text-xs font-semibold text-rose-400">kg CO₂</span>
        </div>
        <div className="mt-2.5 pt-2 border-t border-[#1f293d] flex items-center justify-between text-[10px] text-slate-400 font-mono">
          <span className="text-slate-400">Instant Rate:</span>
          <span className="text-amber-400 font-bold tabular-nums">
            {currentTelemetry.emissionRate_gs} g/s
          </span>
        </div>
      </div>

      {/* CARD 3: Corridor Idle Share */}
      <div className="command-card rounded-lg p-3.5 relative overflow-hidden group">
        <div className="absolute top-0 right-0 h-16 w-16 bg-rose-500/10 rounded-bl-full pointer-events-none transition-transform group-hover:scale-110" />
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
          <span className="font-mono uppercase tracking-wider text-[11px] text-slate-400 flex items-center gap-1.5">
            <Gauge className={`h-3.5 w-3.5 ${isIdleBreached ? 'text-rose-400' : 'text-emerald-400'}`} />
            Corridor Idle Share
          </span>
          <div className={`flex items-center text-[10px] font-mono font-semibold gap-0.5 ${isIdleBreached ? 'text-rose-400' : 'text-emerald-400'}`}>
            <ArrowUpRight className="h-3 w-3" />
            <span>{isIdleBreached ? '+4.2%' : '-2.1%'}</span>
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <span className={`text-2xl font-bold font-mono tracking-tight tabular-nums ${isIdleBreached ? 'text-rose-400' : 'text-emerald-400'}`}>
            {idleShare.toFixed(1)}%
          </span>
          <span className="text-xs text-slate-400">of fleet</span>
        </div>
        <div className="mt-2.5 pt-2 border-t border-[#1f293d] flex items-center justify-between text-[10px] font-mono">
          <div className={`flex items-center gap-1 ${isIdleBreached ? 'text-rose-400' : 'text-emerald-400'}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${isIdleBreached ? 'bg-rose-500 animate-ping' : 'bg-emerald-500'}`} />
            <span>{isIdleBreached ? 'Exceeds 40% Threshold' : 'Green Flow Wave'}</span>
          </div>
          <span className="text-slate-500">3s window</span>
        </div>
      </div>

      {/* CARD 4: Heavy Stop Events */}
      <div className="command-card rounded-lg p-3.5 relative overflow-hidden group">
        <div className="absolute top-0 right-0 h-16 w-16 bg-amber-500/5 rounded-bl-full pointer-events-none transition-transform group-hover:scale-110" />
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
          <span className="font-mono uppercase tracking-wider text-[11px] text-slate-400 flex items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
            Heavy Stop Events
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/40">
            Bus + Truck
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold font-mono tracking-tight text-amber-300 tabular-nums">
            {heavyStopEvents}
          </span>
          <span className="text-xs text-slate-400">stops / hr</span>
        </div>
        <div className="mt-2.5 pt-2 border-t border-[#1f293d] flex items-center justify-between text-[10px] text-slate-400 font-mono">
          <span>Bus: {busStops} stops</span>
          <span className="text-slate-600">|</span>
          <span>Truck: {truckStops} stops</span>
          <span className="text-slate-600">|</span>
          <span className="text-amber-400/90 font-semibold">High Inertia</span>
        </div>
      </div>

      {/* CARD 5: Top Choke Point */}
      <div className={`command-card rounded-lg p-3.5 relative overflow-hidden group border-rose-500/30 ${isCriticalChoke ? 'bg-[#16121f]' : 'bg-[#111827]'}`}>
        <div className="absolute top-0 right-0 h-16 w-16 bg-rose-500/10 rounded-bl-full pointer-events-none" />
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
          <span className="font-mono uppercase tracking-wider text-[11px] text-rose-300 flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-rose-400" />
            Top Choke Point
          </span>
          <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
            isCriticalChoke
              ? 'bg-rose-600 text-white animate-pulse'
              : 'bg-amber-600 text-white'
          }`}>
            {topChokePoint.intensity.toUpperCase()}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold font-mono tracking-tight text-white tabular-nums">
            {topChokePoint.zoneId}
          </span>
          <span className="text-xs text-rose-300 font-medium truncate max-w-[130px]">
            {topChokePoint.label}
          </span>
        </div>
        <div className="mt-2.5 pt-2 border-t border-[#1f293d] flex items-center justify-between text-[10px] font-mono">
          <span className="text-slate-400">Idle Accumulation:</span>
          <span className="text-rose-400 font-bold tabular-nums">
            {topChokePoint.idleMins} veh-mins
          </span>
        </div>
      </div>

    </div>
  );
};
