'use client';

import React, { useState, useEffect } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  FastForward,
  Maximize2,
  Volume2,
  VolumeX,
  Radio,
  Eye,
  Shield,
  Layers,
  Sparkles,
  Info,
} from 'lucide-react';
import { BoundingBox, KinematicState } from '@/types/dashboard';
import { getVehiclesAtTime } from '@/data/mockData';

interface CctvPlayerProps {
  currentTimeSec: number;
  onTimeChange: (time: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  playbackSpeed: number;
  onChangeSpeed: (speed: number) => void;
  activeStateCounts: {
    IDLE: number;
    ACCEL: number;
    CRUISE: number;
    DECEL: number;
  };
  maxTimeSec?: number;
  vehiclesByTime?: Record<string, BoundingBox[]>;
}

const STATE_CONFIG: Record<
  KinematicState,
  { label: string; color: string; bg: string; border: string; glow: string }
> = {
  IDLE: {
    label: 'IDLE (<2 km/h >3s)',
    color: '#f43f5e',
    bg: 'bg-rose-950/40',
    border: 'border-rose-500/40',
    glow: 'shadow-[0_0_12px_rgba(244,63,94,0.3)]',
  },
  ACCEL: {
    label: 'ACCEL (dv/dt > 0.8)',
    color: '#f59e0b',
    bg: 'bg-amber-950/40',
    border: 'border-amber-500/40',
    glow: 'shadow-[0_0_12px_rgba(245,158,11,0.3)]',
  },
  CRUISE: {
    label: 'CRUISE (15–50 km/h)',
    color: '#10b981',
    bg: 'bg-emerald-950/40',
    border: 'border-emerald-500/40',
    glow: 'shadow-[0_0_12px_rgba(16,185,129,0.3)]',
  },
  DECEL: {
    label: 'DECEL (dv/dt < -0.8)',
    color: '#0ea5e9',
    bg: 'bg-sky-950/40',
    border: 'border-sky-500/40',
    glow: 'shadow-[0_0_12px_rgba(14,165,233,0.3)]',
  },
};

export const CctvPlayer: React.FC<CctvPlayerProps> = ({
  currentTimeSec,
  onTimeChange,
  isPlaying,
  onTogglePlay,
  playbackSpeed,
  onChangeSpeed,
  activeStateCounts,
  maxTimeSec = 96.5,
  vehiclesByTime,
}) => {
  const [vehicles, setVehicles] = useState<BoundingBox[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<KinematicState | 'ALL'>('ALL');
  const [showConfidence, setShowConfidence] = useState(true);

  useEffect(() => {
    const bucketKey = String(Math.floor(currentTimeSec / 2) * 2);
    if (vehiclesByTime && vehiclesByTime[bucketKey] && vehiclesByTime[bucketKey].length > 0) {
      setVehicles(vehiclesByTime[bucketKey]);
    } else {
      setVehicles(getVehiclesAtTime(currentTimeSec));
    }
  }, [currentTimeSec, vehiclesByTime]);

  const filteredVehicles =
    selectedFilter === 'ALL'
      ? vehicles
      : vehicles.filter((v) => v.state === selectedFilter);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const totalFilteredCount =
    activeStateCounts.IDLE +
    activeStateCounts.ACCEL +
    activeStateCounts.CRUISE +
    activeStateCounts.DECEL;

  return (
    <div className="command-card rounded-xl p-4 flex flex-col gap-3.5 relative">
      {/* CCTV Viewport Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1f293d] pb-2.5">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 font-mono text-[10px] uppercase font-bold">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-ping" />
            SYNCHRONIZED TWIN FEED
          </div>
          <span className="text-xs font-mono text-slate-400">
            CAM-04-NORTH // MG RD ARTERIAL
          </span>
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
          <span className="text-slate-500">RES:</span>
          <span className="text-slate-300">1280x720</span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-500">INFERENCE:</span>
          <span className="text-emerald-400">YOLO26n CPU</span>
        </div>
      </div>

      {/* CCTV Screen Frame */}
      <div className="relative aspect-video w-full rounded-lg bg-[#070b12] border border-[#1f293d] overflow-hidden shadow-2xl select-none group">
        
        {/* Synthetic Urban Road Geometry Background */}
        <div className="absolute inset-0 opacity-40">
          {/* Main North-South Corridor */}
          <div className="absolute left-[30%] right-[30%] top-0 bottom-0 bg-[#0d1527] border-x-2 border-dashed border-slate-700/60">
            {/* Center Yellow Road Marking */}
            <div className="absolute left-1/2 top-0 bottom-0 w-1 bg-amber-500/40 -translate-x-1/2" />
            {/* White Lane dividers */}
            <div className="absolute left-1/4 top-0 bottom-0 w-0.5 border-r border-dashed border-slate-600/40" />
            <div className="absolute left-3/4 top-0 bottom-0 w-0.5 border-r border-dashed border-slate-600/40" />
            
            {/* North Stopline */}
            <div className="absolute top-[48%] left-0 right-0 h-1.5 bg-rose-500/80 shadow-[0_0_8px_rgba(244,63,94,0.5)]" />
            <div className="absolute top-[49.5%] left-2 text-[9px] font-mono text-rose-400 font-bold tracking-widest">
              STOP LINE // ZONE Z_1_2
            </div>
          </div>

          {/* East-West Cross Arterial */}
          <div className="absolute top-[50%] bottom-[25%] left-0 right-0 bg-[#0a1120] border-y-2 border-dashed border-slate-700/50">
            <div className="absolute top-1/2 left-0 right-0 h-0.5 border-b border-dashed border-slate-600/40" />
          </div>

          {/* 4x4 Grid Overlay Markers */}
          <div className="absolute inset-0 grid grid-cols-4 grid-rows-4 pointer-events-none">
            {Array.from({ length: 16 }).map((_, i) => (
              <div
                key={i}
                className="border border-slate-800/30 flex items-start p-1 text-[8px] font-mono text-slate-700"
              >
                {`Z_${Math.floor(i / 4)}_${i % 4}`}
              </div>
            ))}
          </div>
        </div>

        {/* Scanline CRT FX */}
        <div className="scanline-overlay absolute inset-0 pointer-events-none" />

        {/* Zero-PII Egress Watermark / HUD Overlay */}
        <div className="absolute top-2.5 left-2.5 z-20 flex flex-col gap-1 pointer-events-none">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#090d16]/85 border border-[#1f293d] backdrop-blur-md">
            <Shield className="h-3 w-3 text-emerald-400" />
            <span className="text-[10px] font-mono tracking-tight text-emerald-300 font-medium">
              PRIVACY COMPLIANT: ZERO-PII EGRESS (NO FACE / NO PLATE CACHE)
            </span>
          </div>
          <div className="text-[9px] font-mono text-slate-500 bg-[#090d16]/75 px-1.5 py-0.5 rounded w-fit">
            TIMESTAMP: {formatTime(currentTimeSec)} / 02:00 • FRAME {Math.floor(currentTimeSec * 25)}
          </div>
        </div>

        {/* Dynamic Vehicle Bounding Boxes */}
        {filteredVehicles.map((veh) => {
          const cfg = STATE_CONFIG[veh.state];
          const isSelected = selectedFilter === 'ALL' || selectedFilter === veh.state;

          return (
            <div
              key={veh.id}
              className={`absolute transition-all duration-300 border-2 rounded ${cfg.glow}`}
              style={{
                left: `${veh.x}%`,
                top: `${veh.y}%`,
                width: `${veh.width}%`,
                height: `${veh.height}%`,
                borderColor: cfg.color,
                backgroundColor: `${cfg.color}15`,
                opacity: isSelected ? 1 : 0.25,
              }}
            >
              {/* Corner brackets */}
              <div
                className="absolute -top-1 -left-1 w-2 h-2 border-t-2 border-l-2"
                style={{ borderColor: cfg.color }}
              />
              <div
                className="absolute -top-1 -right-1 w-2 h-2 border-t-2 border-r-2"
                style={{ borderColor: cfg.color }}
              />

              {/* Vehicle Floating Label Tag */}
              <div
                className="absolute -top-6 left-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold whitespace-nowrap shadow-md"
                style={{ backgroundColor: '#090d16cc', border: `1px solid ${cfg.color}` }}
              >
                <span style={{ color: cfg.color }}>{veh.state}</span>
                <span className="text-slate-300">{veh.classType}</span>
                <span className="text-slate-400 tabular-nums">{veh.speedKmh} km/h</span>
                <span className="text-rose-400 font-mono font-semibold">
                  {veh.co2Rate_gs.toFixed(2)} g/s
                </span>
              </div>

              {/* Kinematic State Indicator Dot */}
              <div className="absolute bottom-1 right-1 flex items-center gap-0.5">
                <span
                  className="h-1.5 w-1.5 rounded-full animate-ping"
                  style={{ backgroundColor: cfg.color }}
                />
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: cfg.color }}
                />
              </div>
            </div>
          );
        })}

        {/* Active Phase Banner */}
        <div className="absolute bottom-2.5 right-2.5 z-20">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-[#090d16]/90 border border-[#1f293d] backdrop-blur-md">
            <span className="text-[10px] font-mono text-slate-400">CORRIDOR PHASE:</span>
            {currentTimeSec >= 24 && currentTimeSec <= 68 ? (
              <span className="text-[11px] font-mono font-bold text-rose-400 flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                NORTH RED STOP (QUEUE BUILD)
              </span>
            ) : currentTimeSec > 68 && currentTimeSec <= 90 ? (
              <span className="text-[11px] font-mono font-bold text-emerald-400 flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                GREEN WAVE DISCHARGE
              </span>
            ) : (
              <span className="text-[11px] font-mono font-bold text-sky-400 flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-sky-500 animate-pulse" />
                DYNAMIC CRUISE
              </span>
            )}
          </div>
        </div>

      </div>

      {/* Scrubbing Timeline & Playback Controls */}
      <div className="flex flex-col gap-2 pt-1">
        
        {/* Timeline Range Bar */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono font-semibold text-emerald-400 tabular-nums min-w-[42px]">
            {formatTime(currentTimeSec)}
          </span>
          
          <div className="relative flex-1 group/slider flex items-center">
            <input
              type="range"
              min="0"
              max={Math.ceil(maxTimeSec)}
              step="1"
              value={currentTimeSec}
              onChange={(e) => onTimeChange(Number(e.target.value))}
              className="w-full h-2 bg-[#1a2333] rounded-lg appearance-none cursor-pointer accent-emerald-500 focus:outline-none"
            />
            {/* Visual Markers for Choke Spikes on Timeline */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-rose-500/80 pointer-events-none"
              style={{ left: `${Math.min(100, (24 / maxTimeSec) * 100)}%` }}
              title="Red Phase Start (24s)"
            />
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-emerald-500/80 pointer-events-none"
              style={{ left: `${Math.min(100, (68 / maxTimeSec) * 100)}%` }}
              title="Green Phase Discharge (68s)"
            />
          </div>

          <span className="text-xs font-mono text-slate-500 tabular-nums min-w-[42px]">
            {formatTime(maxTimeSec)}
          </span>
        </div>

        {/* Transport Buttons Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          
          <div className="flex items-center gap-1.5">
            {/* Rewind */}
            <button
              onClick={() => onTimeChange(0)}
              className="p-1.5 rounded bg-[#111827] border border-[#1f293d] hover:border-slate-500 text-slate-300 transition-colors"
              title="Reset to 00:00"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>

            {/* Play/Pause */}
            <button
              onClick={onTogglePlay}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-mono text-xs font-bold transition-all ${
                isPlaying
                  ? 'bg-amber-500/20 border border-amber-500 text-amber-300 hover:bg-amber-500/30'
                  : 'bg-emerald-600 text-slate-950 hover:bg-emerald-500 shadow-md'
              }`}
            >
              {isPlaying ? (
                <>
                  <Pause className="h-3.5 w-3.5 fill-current" />
                  PAUSE
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 fill-current" />
                  PLAY
                </>
              )}
            </button>

            {/* Speed Multiplier */}
            <div className="flex items-center rounded bg-[#111827] border border-[#1f293d] p-0.5 text-[10px] font-mono">
              {[1, 2, 4].map((speed) => (
                <button
                  key={speed}
                  onClick={() => onChangeSpeed(speed)}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    playbackSpeed === speed
                      ? 'bg-emerald-500/20 text-emerald-400 font-bold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {speed}x
                </button>
              ))}
            </div>
          </div>

          {/* Live Sync Status */}
          <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-400 bg-emerald-950/30 border border-emerald-500/30 px-2 py-1 rounded">
            <Radio className="h-3 w-3 animate-pulse text-emerald-400" />
            <span>EDGE TWIN SYNCED (dt=0.08s)</span>
          </div>

        </div>

      </div>

      {/* Kinematic State Breakdown Interactive Pills */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-[#1f293d]">
        {(['IDLE', 'ACCEL', 'CRUISE', 'DECEL'] as KinematicState[]).map((state) => {
          const cfg = STATE_CONFIG[state];
          const count = activeStateCounts[state] || 0;
          const share = totalFilteredCount > 0 ? Math.round((count / totalFilteredCount) * 100) : 0;
          const isFilterActive = selectedFilter === state;

          return (
            <button
              key={state}
              onClick={() => setSelectedFilter(selectedFilter === state ? 'ALL' : state)}
              className={`flex flex-col p-2 rounded-lg border text-left transition-all ${
                isFilterActive
                  ? `${cfg.border} ${cfg.bg} ring-1 ring-emerald-500/50`
                  : 'border-[#1f293d] bg-[#0c121e] hover:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-xs font-mono font-bold tracking-wider"
                  style={{ color: cfg.color }}
                >
                  {state}
                </span>
                <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                  {share}%
                </span>
              </div>
              <div className="text-[10px] text-slate-400 truncate mt-0.5">
                {cfg.label}
              </div>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-sm font-bold font-mono text-slate-100 tabular-nums">
                  {count}
                </span>
                <span className="text-[10px] text-slate-500">vehicles</span>
              </div>
            </button>
          );
        })}
      </div>

    </div>
  );
};
