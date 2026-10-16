'use client';

import React, { useState } from 'react';
import { ChokeZone, VehicleClass } from '@/types/dashboard';
import {
  Grid,
  MapPin,
  AlertOctagon,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Info,
  X,
  Truck,
  Bus,
} from 'lucide-react';

interface SpatialChokeMatrixProps {
  zones: ChokeZone[];
  selectedZone: ChokeZone | null;
  onSelectZone: (zone: ChokeZone) => void;
}

const INTENSITY_COLORS: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  low: {
    bg: 'bg-emerald-950/20 hover:bg-emerald-950/40',
    border: 'border-emerald-800/30 hover:border-emerald-500/50',
    text: 'text-emerald-400',
    glow: '',
  },
  moderate: {
    bg: 'bg-amber-950/25 hover:bg-amber-950/45',
    border: 'border-amber-700/40 hover:border-amber-500/60',
    text: 'text-amber-400',
    glow: '',
  },
  high: {
    bg: 'bg-rose-950/40 hover:bg-rose-950/60',
    border: 'border-rose-600/50 hover:border-rose-500/80',
    text: 'text-rose-400',
    glow: 'shadow-[0_0_10px_rgba(244,63,94,0.15)]',
  },
  critical: {
    bg: 'bg-rose-950/70 hover:bg-rose-950/90',
    border: 'border-rose-500 hover:border-rose-400 ring-1 ring-rose-500/50',
    text: 'text-rose-300 font-bold',
    glow: 'shadow-[0_0_18px_rgba(244,63,94,0.4)] animate-pulse-slow',
  },
};

const CLASS_ICONS: Record<VehicleClass, string> = {
  car: '🚗',
  motorcycle: '🛵',
  auto_rickshaw: '🛺',
  bus: '🚌',
  truck: '🚛',
};

export const SpatialChokeMatrix: React.FC<SpatialChokeMatrixProps> = ({
  zones,
  selectedZone,
  onSelectZone,
}) => {
  const [inspectModalOpen, setInspectModalOpen] = useState(false);

  const handleZoneClick = (zone: ChokeZone) => {
    onSelectZone(zone);
    setInspectModalOpen(true);
  };

  return (
    <div className="command-card rounded-xl p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#1f293d] pb-2.5">
        <div className="flex items-center gap-2">
          <Grid className="h-4 w-4 text-emerald-400" />
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-200">
            4×4 Spatial Choke-Point Matrix
          </span>
        </div>
        <span className="text-[10px] font-mono text-slate-400">
          Ranked by Idle Veh-Mins
        </span>
      </div>

      {/* Directional Guide Bar */}
      <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 px-1">
        <div className="flex items-center gap-1">
          <ArrowUp className="h-3 w-3 text-sky-400" />
          <span>North Approach (MG Rd)</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-500/30 border border-emerald-500" />
            &lt; 0.5m
          </span>
          <span className="flex items-center gap-1 text-amber-400">
            <span className="h-2 w-2 rounded-full bg-amber-500/30 border border-amber-500" />
            0.5–1.5m
          </span>
          <span className="flex items-center gap-1 text-rose-400">
            <span className="h-2 w-2 rounded-full bg-rose-500/30 border border-rose-500" />
            &gt; 1.5m
          </span>
        </div>
      </div>

      {/* 4x4 Grid Matrix */}
      <div className="grid grid-cols-4 gap-2">
        {zones.map((zone) => {
          const style = INTENSITY_COLORS[zone.intensity] || INTENSITY_COLORS.low;
          const isSelected = selectedZone?.zoneId === zone.zoneId;

          return (
            <button
              key={zone.zoneId}
              onClick={() => handleZoneClick(zone)}
              className={`p-2 rounded-lg border flex flex-col justify-between h-20 text-left transition-all relative group cursor-pointer ${
                style.bg
              } ${style.border} ${style.glow} ${
                isSelected ? 'ring-2 ring-emerald-400 scale-[1.02]' : ''
              }`}
            >
              {/* Zone Tag & Lane */}
              <div className="flex items-center justify-between w-full">
                <span className="text-[10px] font-mono font-bold text-slate-300">
                  {zone.zoneId}
                </span>
                <span className="text-[9px] font-mono px-1 rounded bg-[#090d16] text-slate-400">
                  {zone.lane}
                </span>
              </div>

              {/* Dominant Vehicle & Idle Count */}
              <div className="flex items-center justify-between my-0.5">
                <span className="text-sm" title={`Dominant: ${zone.dominantClass}`}>
                  {CLASS_ICONS[zone.dominantClass]}
                </span>
                <span className={`text-xs font-mono font-bold tabular-nums ${style.text}`}>
                  {zone.idleVehicleMins.toFixed(1)}m
                </span>
              </div>

              {/* Vehicles Bottlenecked */}
              <div className="flex items-center justify-between text-[9px] font-mono text-slate-400">
                <span>{zone.vehicleCount} queued</span>
                {zone.heavyVehicleCount > 0 && (
                  <span className="text-amber-400 font-semibold" title="Heavy Bus/Truck Count">
                    {zone.heavyVehicleCount}H
                  </span>
                )}
              </div>

              {zone.intensity === 'critical' && (
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-600" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected Zone Quick Bar */}
      {selectedZone && (
        <div className="p-2.5 rounded-lg bg-[#0c121e] border border-[#1f293d] flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="text-rose-400 font-bold">{selectedZone.zoneId}:</span>
            <span className="text-slate-200">{selectedZone.label}</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <span>{selectedZone.vehicleCount} vehs ({selectedZone.heavyVehicleCount} heavy)</span>
            <span className="text-rose-400 font-bold">
              {selectedZone.idleVehicleMins} veh-mins
            </span>
          </div>
        </div>
      )}

      {/* Zone Inspector Modal */}
      {inspectModalOpen && selectedZone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="command-card rounded-xl max-w-md w-full p-5 border border-emerald-500/30 shadow-2xl relative">
            <button
              onClick={() => setInspectModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-100"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-2 text-emerald-400 font-mono text-xs font-bold uppercase mb-2">
              <MapPin className="h-4 w-4" />
              Choke Zone Deep Diagnostics
            </div>

            <h3 className="text-lg font-bold text-slate-100 mb-1">
              {selectedZone.zoneId} — {selectedZone.label}
            </h3>
            <p className="text-xs text-slate-400 font-mono mb-4">
              Camera polygon calibration coordinate bounds: [0.38, 0.48, 0.62, 0.72]
            </p>

            <div className="grid grid-cols-2 gap-3 mb-4 font-mono text-xs">
              <div className="p-2.5 rounded bg-[#090d16] border border-[#1f293d]">
                <div className="text-slate-400 text-[10px]">CUMULATIVE IDLE</div>
                <div className="text-base font-bold text-rose-400">
                  {selectedZone.idleVehicleMins} veh-mins
                </div>
              </div>
              <div className="p-2.5 rounded bg-[#090d16] border border-[#1f293d]">
                <div className="text-slate-400 text-[10px]">QUEUED VEHICLES</div>
                <div className="text-base font-bold text-slate-100">
                  {selectedZone.vehicleCount} units
                </div>
              </div>
              <div className="p-2.5 rounded bg-[#090d16] border border-[#1f293d]">
                <div className="text-slate-400 text-[10px]">DOMINANT TAXONOMY</div>
                <div className="text-base font-bold text-amber-300 capitalize flex items-center gap-1.5">
                  <span>{CLASS_ICONS[selectedZone.dominantClass]}</span>
                  <span>{selectedZone.dominantClass.replace('_', ' ')}</span>
                </div>
              </div>
              <div className="p-2.5 rounded bg-[#090d16] border border-[#1f293d]">
                <div className="text-slate-400 text-[10px]">HEAVY FLEET RATIO</div>
                <div className="text-base font-bold text-orange-400">
                  {selectedZone.heavyVehicleCount} Buses / Trucks
                </div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-600/30 text-xs text-amber-200/90 mb-4 font-mono leading-relaxed">
              <strong>Operational Recommendation:</strong> Heavy vehicle queue accumulation in this zone accounts for 42% of local idling CO2. Applying an adaptive green extension of +12s dissipates bottleneck before cross-arterial stop wave.
            </div>

            <button
              onClick={() => setInspectModalOpen(false)}
              className="w-full py-2 rounded-lg bg-[#1f293d] hover:bg-slate-700 text-xs font-mono font-semibold text-slate-200 transition-colors"
            >
              Close Diagnostics
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
