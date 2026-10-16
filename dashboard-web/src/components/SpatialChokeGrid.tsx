'use client';

import React, { useState, useMemo } from 'react';
import {
  Grid,
  MapPin,
  Flame,
  Truck,
  Bus,
  Car,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  X,
  Target,
  Sparkles,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';

/* =========================================================================
   Types & Interfaces
   ========================================================================= */

export type VehicleClassType = 'car' | 'motorcycle' | 'auto_rickshaw' | 'bus' | 'truck';

export interface SpatialZoneData {
  id: string; // e.g. "z_r1_c2"
  label: string; // e.g. "Z_1_2"
  row: number; // 0..3
  col: number; // 0..3
  name: string; // e.g. "North Stopline (Corridor Core)"
  laneDirection: 'N' | 'S' | 'E' | 'W';
  idle_vehicle_minutes: number;
  idling_vehicles_count: number;
  unique_track_ids: string[];
  heavy_vehicles_count: number; // buses + trucks
  top_idling_class: string;
  top_idling_class_pct: number;
  vehicle_mix: {
    car: number;
    motorcycle: number;
    auto_rickshaw: number;
    bus: number;
    truck: number;
  };
  estimated_excess_idle_co2_g: number;
}

export interface SpatialChokeGridProps {
  zones?: SpatialZoneData[];
  onSelectZone?: (zone: SpatialZoneData) => void;
  className?: string;
  currentTimeSec?: number;
}

/* =========================================================================
   Dynamic Choke Zone Scaler based on Timeline Scrubbing
   ========================================================================= */

export function computeDynamicSpatialZones(
  currentTimeSec: number,
  baseZones: SpatialZoneData[] = DEFAULT_SPATIAL_ZONES
): SpatialZoneData[] {
  // Cycle progression:
  // 0 - 24s: Initial movement / moderate idle
  // 24 - 68s: Red Phase stopline queue build-up on North Corridor
  // 68 - 90s: Green wave discharge
  // 90 - 120s: Steady flow
  return baseZones.map((zone) => {
    let multiplier = 1.0;
    let countMultiplier = 1.0;

    const isNorthStopline = zone.id === 'z_r1_c2'; // Critical choke Z_1_2
    const isNorthCorridor = zone.id === 'z_r0_c2' || zone.id === 'z_r0_c1';
    const isSouthStopline = zone.id === 'z_r2_c1';

    if (currentTimeSec < 24) {
      const ratio = Math.max(0.15, currentTimeSec / 24);
      multiplier = isNorthStopline ? 0.35 + ratio * 0.35 : 0.4 + ratio * 0.3;
      countMultiplier = isNorthStopline ? 0.3 + ratio * 0.4 : 0.4 + ratio * 0.3;
    } else if (currentTimeSec >= 24 && currentTimeSec <= 68) {
      // Red Phase: Queue climbs up drastically
      const prog = (currentTimeSec - 24) / 44; // 0 to 1
      if (isNorthStopline) {
        multiplier = 0.7 + prog * 0.85; // reaches 1.55x base (~3.8 min)
        countMultiplier = 0.7 + prog * 0.8;
      } else if (isNorthCorridor || isSouthStopline) {
        multiplier = 0.6 + prog * 0.65;
        countMultiplier = 0.6 + prog * 0.6;
      } else {
        multiplier = 0.8 + prog * 0.3;
        countMultiplier = 0.8 + prog * 0.25;
      }
    } else if (currentTimeSec > 68 && currentTimeSec <= 90) {
      // Green Phase: Queue dissipates
      const prog = (currentTimeSec - 68) / 22; // 0 to 1
      if (isNorthStopline) {
        multiplier = Math.max(0.35, 1.55 - prog * 1.15);
        countMultiplier = Math.max(0.15, 1.5 - prog * 1.3);
      } else if (isNorthCorridor) {
        multiplier = Math.max(0.35, 1.25 - prog * 0.85);
        countMultiplier = Math.max(0.2, 1.2 - prog * 0.95);
      } else {
        multiplier = Math.max(0.4, 1.1 - prog * 0.5);
        countMultiplier = Math.max(0.3, 1.05 - prog * 0.5);
      }
    } else {
      multiplier = isNorthStopline ? 0.65 : 0.7;
      countMultiplier = 0.6;
    }

    const dynamicIdleMins = +(zone.idle_vehicle_minutes * multiplier).toFixed(2);
    const dynamicIdlingCount = Math.max(1, Math.round(zone.idling_vehicles_count * countMultiplier));
    const dynamicCo2 = Math.round(zone.estimated_excess_idle_co2_g * multiplier);
    const dynamicHeavy = Math.max(0, Math.round(zone.heavy_vehicles_count * countMultiplier));

    return {
      ...zone,
      idle_vehicle_minutes: dynamicIdleMins,
      idling_vehicles_count: dynamicIdlingCount,
      estimated_excess_idle_co2_g: dynamicCo2,
      heavy_vehicles_count: dynamicHeavy,
    };
  });
}

/* =========================================================================
   Realistic Mock 4x4 Grid Telemetry (16 Zones z_r0_c0 to z_r3_c3)
   ========================================================================= */

export const DEFAULT_SPATIAL_ZONES: SpatialZoneData[] = [
  // Row 0 (Top: North Entry Arterial)
  {
    id: 'z_r0_c0',
    label: 'Z_0_0',
    row: 0,
    col: 0,
    name: 'N-Left Slip Lane',
    laneDirection: 'N',
    idle_vehicle_minutes: 0.35,
    idling_vehicles_count: 8,
    unique_track_ids: ['MOT-401', 'MOT-402', 'CAR-108'],
    heavy_vehicles_count: 0,
    top_idling_class: 'Motorcycle',
    top_idling_class_pct: 62,
    vehicle_mix: { car: 25, motorcycle: 62, auto_rickshaw: 13, bus: 0, truck: 0 },
    estimated_excess_idle_co2_g: 140.0,
  },
  {
    id: 'z_r0_c1',
    label: 'Z_0_1',
    row: 0,
    col: 1,
    name: 'North Thru Corridor 1',
    laneDirection: 'N',
    idle_vehicle_minutes: 1.85,
    idling_vehicles_count: 36,
    unique_track_ids: ['BUS-102', 'BUS-103', 'CAR-114', 'AUT-304'],
    heavy_vehicles_count: 7,
    top_idling_class: 'Transit Bus',
    top_idling_class_pct: 42,
    vehicle_mix: { car: 30, motorcycle: 18, auto_rickshaw: 10, bus: 42, truck: 0 },
    estimated_excess_idle_co2_g: 1720.5,
  },
  {
    id: 'z_r0_c2',
    label: 'Z_0_2',
    row: 0,
    col: 2,
    name: 'North Thru Corridor 2',
    laneDirection: 'N',
    idle_vehicle_minutes: 2.15,
    idling_vehicles_count: 44,
    unique_track_ids: ['TRK-108', 'TRK-109', 'BUS-105', 'CAR-120'],
    heavy_vehicles_count: 11,
    top_idling_class: 'Freight Truck',
    top_idling_class_pct: 48,
    vehicle_mix: { car: 22, motorcycle: 15, auto_rickshaw: 15, bus: 20, truck: 28 },
    estimated_excess_idle_co2_g: 2240.0,
  },
  {
    id: 'z_r0_c3',
    label: 'Z_0_3',
    row: 0,
    col: 3,
    name: 'N-Right Turn Pocket',
    laneDirection: 'N',
    idle_vehicle_minutes: 0.95,
    idling_vehicles_count: 17,
    unique_track_ids: ['CAR-130', 'CAR-131', 'AUT-312'],
    heavy_vehicles_count: 1,
    top_idling_class: 'Passenger Car',
    top_idling_class_pct: 58,
    vehicle_mix: { car: 58, motorcycle: 22, auto_rickshaw: 15, bus: 5, truck: 0 },
    estimated_excess_idle_co2_g: 780.0,
  },

  // Row 1 (Intersection Core - North Approach Stopline)
  {
    id: 'z_r1_c0',
    label: 'Z_1_0',
    row: 1,
    col: 0,
    name: 'West Exit Discharge',
    laneDirection: 'W',
    idle_vehicle_minutes: 0.28,
    idling_vehicles_count: 6,
    unique_track_ids: ['AUT-319', 'MOT-418'],
    heavy_vehicles_count: 0,
    top_idling_class: 'Auto-Rickshaw',
    top_idling_class_pct: 55,
    vehicle_mix: { car: 20, motorcycle: 25, auto_rickshaw: 55, bus: 0, truck: 0 },
    estimated_excess_idle_co2_g: 112.0,
  },
  {
    id: 'z_r1_c1',
    label: 'Z_1_1',
    row: 1,
    col: 1,
    name: 'Central Junction NW Box',
    laneDirection: 'N',
    idle_vehicle_minutes: 1.45,
    idling_vehicles_count: 28,
    unique_track_ids: ['CAR-140', 'AUT-322', 'MOT-425'],
    heavy_vehicles_count: 2,
    top_idling_class: 'Auto-Rickshaw',
    top_idling_class_pct: 46,
    vehicle_mix: { car: 32, motorcycle: 15, auto_rickshaw: 46, bus: 7, truck: 0 },
    estimated_excess_idle_co2_g: 1180.0,
  },
  {
    id: 'z_r1_c2',
    label: 'Z_1_2',
    row: 1,
    col: 2,
    name: 'North Stopline (CRITICAL CHOKE)',
    laneDirection: 'N',
    idle_vehicle_minutes: 3.42,
    idling_vehicles_count: 58,
    unique_track_ids: ['BUS-104', 'BUS-106', 'TRK-105', 'AUT-301', 'CAR-202'],
    heavy_vehicles_count: 16,
    top_idling_class: 'Transit Bus',
    top_idling_class_pct: 52,
    vehicle_mix: { car: 20, motorcycle: 12, auto_rickshaw: 16, bus: 38, truck: 14 },
    estimated_excess_idle_co2_g: 3410.5,
  },
  {
    id: 'z_r1_c3',
    label: 'Z_1_3',
    row: 1,
    col: 3,
    name: 'East Entry Merge Lane',
    laneDirection: 'E',
    idle_vehicle_minutes: 1.15,
    idling_vehicles_count: 23,
    unique_track_ids: ['MOT-430', 'CAR-150', 'BUS-112'],
    heavy_vehicles_count: 2,
    top_idling_class: 'Motorcycle',
    top_idling_class_pct: 48,
    vehicle_mix: { car: 28, motorcycle: 48, auto_rickshaw: 15, bus: 9, truck: 0 },
    estimated_excess_idle_co2_g: 890.0,
  },

  // Row 2 (Intersection Core - South Approach Stopline)
  {
    id: 'z_r2_c0',
    label: 'Z_2_0',
    row: 2,
    col: 0,
    name: 'West Inflow Approach',
    laneDirection: 'W',
    idle_vehicle_minutes: 0.82,
    idling_vehicles_count: 18,
    unique_track_ids: ['CAR-155', 'AUT-330'],
    heavy_vehicles_count: 1,
    top_idling_class: 'Passenger Car',
    top_idling_class_pct: 50,
    vehicle_mix: { car: 50, motorcycle: 28, auto_rickshaw: 16, bus: 6, truck: 0 },
    estimated_excess_idle_co2_g: 640.0,
  },
  {
    id: 'z_r2_c1',
    label: 'Z_2_1',
    row: 2,
    col: 1,
    name: 'South Stopline Primary',
    laneDirection: 'S',
    idle_vehicle_minutes: 2.38,
    idling_vehicles_count: 46,
    unique_track_ids: ['TRK-114', 'TRK-116', 'BUS-118', 'CAR-162'],
    heavy_vehicles_count: 13,
    top_idling_class: 'Freight Truck',
    top_idling_class_pct: 44,
    vehicle_mix: { car: 24, motorcycle: 14, auto_rickshaw: 18, bus: 16, truck: 28 },
    estimated_excess_idle_co2_g: 2480.0,
  },
  {
    id: 'z_r2_c2',
    label: 'Z_2_2',
    row: 2,
    col: 2,
    name: 'Central Junction SE Box',
    laneDirection: 'S',
    idle_vehicle_minutes: 1.25,
    idling_vehicles_count: 26,
    unique_track_ids: ['AUT-340', 'CAR-170'],
    heavy_vehicles_count: 2,
    top_idling_class: 'Auto-Rickshaw',
    top_idling_class_pct: 50,
    vehicle_mix: { car: 28, motorcycle: 15, auto_rickshaw: 50, bus: 7, truck: 0 },
    estimated_excess_idle_co2_g: 990.0,
  },
  {
    id: 'z_r2_c3',
    label: 'Z_2_3',
    row: 2,
    col: 3,
    name: 'East Exit Slip Lane',
    laneDirection: 'E',
    idle_vehicle_minutes: 0.18,
    idling_vehicles_count: 4,
    unique_track_ids: ['MOT-442'],
    heavy_vehicles_count: 0,
    top_idling_class: 'Motorcycle',
    top_idling_class_pct: 75,
    vehicle_mix: { car: 25, motorcycle: 75, auto_rickshaw: 0, bus: 0, truck: 0 },
    estimated_excess_idle_co2_g: 65.0,
  },

  // Row 3 (Bottom: South Discharge Arterial)
  {
    id: 'z_r3_c0',
    label: 'Z_3_0',
    row: 3,
    col: 0,
    name: 'S-Right Turn Pocket',
    laneDirection: 'S',
    idle_vehicle_minutes: 0.65,
    idling_vehicles_count: 14,
    unique_track_ids: ['CAR-180', 'AUT-350'],
    heavy_vehicles_count: 1,
    top_idling_class: 'Passenger Car',
    top_idling_class_pct: 52,
    vehicle_mix: { car: 52, motorcycle: 26, auto_rickshaw: 15, bus: 7, truck: 0 },
    estimated_excess_idle_co2_g: 480.0,
  },
  {
    id: 'z_r3_c1',
    label: 'Z_3_1',
    row: 3,
    col: 1,
    name: 'South Thru Corridor 1',
    laneDirection: 'S',
    idle_vehicle_minutes: 1.55,
    idling_vehicles_count: 31,
    unique_track_ids: ['CAR-190', 'BUS-122'],
    heavy_vehicles_count: 4,
    top_idling_class: 'Passenger Car',
    top_idling_class_pct: 42,
    vehicle_mix: { car: 42, motorcycle: 25, auto_rickshaw: 20, bus: 13, truck: 0 },
    estimated_excess_idle_co2_g: 1320.0,
  },
  {
    id: 'z_r3_c2',
    label: 'Z_3_2',
    row: 3,
    col: 2,
    name: 'South Thru Corridor 2',
    laneDirection: 'S',
    idle_vehicle_minutes: 1.10,
    idling_vehicles_count: 24,
    unique_track_ids: ['MOT-450', 'CAR-195'],
    heavy_vehicles_count: 2,
    top_idling_class: 'Motorcycle',
    top_idling_class_pct: 45,
    vehicle_mix: { car: 30, motorcycle: 45, auto_rickshaw: 18, bus: 7, truck: 0 },
    estimated_excess_idle_co2_g: 810.0,
  },
  {
    id: 'z_r3_c3',
    label: 'Z_3_3',
    row: 3,
    col: 3,
    name: 'S-Left Merge Slip',
    laneDirection: 'S',
    idle_vehicle_minutes: 0.22,
    idling_vehicles_count: 5,
    unique_track_ids: ['AUT-360'],
    heavy_vehicles_count: 0,
    top_idling_class: 'Auto-Rickshaw',
    top_idling_class_pct: 60,
    vehicle_mix: { car: 20, motorcycle: 20, auto_rickshaw: 60, bus: 0, truck: 0 },
    estimated_excess_idle_co2_g: 90.0,
  },
];

/* =========================================================================
   Helper: Color Scale Intensity Calculation
   ========================================================================= */

function getCellColorStyle(idleMins: number, isSelected: boolean): {
  bg: string;
  border: string;
  text: string;
  glow: string;
  badgeBg: string;
} {
  // Low Idle (< 0.5m)
  if (idleMins < 0.5) {
    return {
      bg: isSelected
        ? 'bg-slate-800'
        : 'bg-[#141b2a] hover:bg-[#1a2336]',
      border: isSelected ? 'border-sky-400 ring-2 ring-sky-500/50' : 'border-[#1f293d] hover:border-slate-600',
      text: 'text-slate-300',
      glow: '',
      badgeBg: 'bg-slate-800 text-slate-400 border border-slate-700',
    };
  }

  // Moderate (0.5m - 2.0m)
  if (idleMins <= 2.0) {
    const ratio = (idleMins - 0.5) / 1.5; // 0 to 1
    return {
      bg: isSelected
        ? 'bg-amber-950/80'
        : ratio > 0.5
        ? 'bg-amber-950/40 hover:bg-amber-950/60'
        : 'bg-amber-950/25 hover:bg-amber-950/45',
      border: isSelected
        ? 'border-amber-400 ring-2 ring-amber-500/60'
        : 'border-amber-700/50 hover:border-amber-500',
      text: 'text-amber-300 font-bold',
      glow: 'shadow-[0_0_12px_rgba(245,158,11,0.15)]',
      badgeBg: 'bg-amber-950 text-amber-300 border border-amber-800',
    };
  }

  // Severe Choke Point (> 2.0m) - Intense fiery red/amber #ef4444
  return {
    bg: isSelected
      ? 'bg-rose-950/90'
      : 'bg-gradient-to-br from-rose-950/70 via-red-950/60 to-rose-900/40 hover:from-rose-950/90 hover:to-red-900/60',
    border: isSelected
      ? 'border-rose-400 ring-2 ring-rose-500'
      : 'border-rose-500 hover:border-rose-400 ring-1 ring-rose-500/40',
    text: 'text-rose-200 font-black',
    glow: 'shadow-[0_0_20px_rgba(239,68,68,0.35)]',
    badgeBg: 'bg-rose-600 text-white font-bold animate-pulse',
  };
}

/* =========================================================================
   Component: SpatialChokeGrid
   ========================================================================= */

export const SpatialChokeGrid: React.FC<SpatialChokeGridProps> = ({
  zones = DEFAULT_SPATIAL_ZONES,
  onSelectZone,
  className = '',
  currentTimeSec,
}) => {
  // Focus / selected zone state (default to top choke zone Z_1_2)
  const [selectedZoneId, setSelectedZoneId] = useState<string>('z_r1_c2');
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState<boolean>(false);

  // Compute synchronized dynamic zones when currentTimeSec is provided
  const activeZones = useMemo(() => {
    if (currentTimeSec !== undefined) {
      return computeDynamicSpatialZones(currentTimeSec, zones);
    }
    return zones;
  }, [currentTimeSec, zones]);

  // Active zone (either hovered or pinned selection)
  const activeZone = useMemo(() => {
    const targetId = hoveredZoneId || selectedZoneId;
    return activeZones.find((z) => z.id === targetId) || activeZones[0];
  }, [activeZones, hoveredZoneId, selectedZoneId]);

  // Ranked Top 3 Choke Points dynamically computed from activeZones
  const top3ChokeZones = useMemo(() => {
    return [...activeZones]
      .sort((a, b) => b.idle_vehicle_minutes - a.idle_vehicle_minutes)
      .slice(0, 3);
  }, [activeZones]);

  const handleCellClick = (zone: SpatialZoneData) => {
    setSelectedZoneId(zone.id);
    setIsDetailDrawerOpen(true);
    if (onSelectZone) onSelectZone(zone);
  };

  const handleFocusRankedZone = (zone: SpatialZoneData) => {
    setSelectedZoneId(zone.id);
    setIsDetailDrawerOpen(true);
    if (onSelectZone) onSelectZone(zone);
  };

  return (
    <div
      className={`command-card rounded-xl p-4 flex flex-col gap-4 border border-[#1f293d] bg-[#111827] shadow-2xl relative ${className}`}
    >
      {/* =====================================================================
          Header Bar with Legend
          ===================================================================== */}
      <div className="flex flex-col gap-2.5 border-b border-[#1f293d] pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400">
              <Grid className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-100 flex items-center gap-1.5">
                4×4 Spatial Choke-Point Heatmap
                <span className="text-[10px] font-mono font-normal px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-[#1f293d]">
                  16 Junction Sectors
                </span>
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {currentTimeSec !== undefined && (
              <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/30 text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                TIMELINE SYNC: {Math.floor(currentTimeSec)}s
              </span>
            )}
            <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
              <Flame className="h-3.5 w-3.5 text-rose-500" />
              <span>Cumulative Idle Veh-Mins</span>
            </div>
          </div>

        </div>

        {/* Legend Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#090d16] border border-[#1f293d] text-[10px] font-mono">
          <span className="text-slate-400 font-semibold uppercase tracking-wider">
            Congestion Intensity Scale:
          </span>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded bg-[#1e293b] border border-slate-600 inline-block" />
              <span className="text-slate-400">Low Idle (&lt; 0.5m)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded bg-amber-500 border border-amber-400 inline-block" />
              <span className="text-amber-300">Moderate (0.5 – 2.0m)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded bg-rose-600 border border-rose-400 inline-block shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
              <span className="text-rose-300 font-bold">Severe Choke (&gt; 2.0m)</span>
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================================
          Spatial 4x4 Grid Layout with Road Orientation Crosshairs
          ===================================================================== */}
      <div className="flex flex-col gap-1.5 relative">
        
        {/* Orientation Labels */}
        <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 px-1">
          <span className="flex items-center gap-1 text-sky-400">
            <ArrowUp className="h-3 w-3" />
            North Inflow (MG Rd Corridor)
          </span>
          <span className="flex items-center gap-1 text-slate-400">
            Camera Spatial Perspective (4x4)
          </span>
        </div>

        {/* The 16-Cell 4x4 Grid */}
        <div className="grid grid-cols-4 gap-2.5 p-2 rounded-xl bg-[#090d16] border border-[#1f293d] relative select-none">
          
          {activeZones.map((zone) => {
            const isSelected = selectedZoneId === zone.id;
            const isHovered = hoveredZoneId === zone.id;
            const style = getCellColorStyle(zone.idle_vehicle_minutes, isSelected);
            const isSevere = zone.idle_vehicle_minutes > 2.0;

            return (
              <button
                key={zone.id}
                onClick={() => handleCellClick(zone)}
                onMouseEnter={() => setHoveredZoneId(zone.id)}
                onMouseLeave={() => setHoveredZoneId(null)}
                className={`relative rounded-lg p-2.5 flex flex-col justify-between h-24 text-left transition-all duration-200 cursor-pointer group border ${
                  style.bg
                } ${style.border} ${style.glow} ${
                  isSelected ? 'scale-[1.03] z-10' : 'hover:scale-[1.01]'
                }`}
              >
                {/* Cell Top Header: Zone ID & Lane Direction */}
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] font-mono font-black tracking-wider text-slate-100">
                      {zone.label}
                    </span>
                    <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-black/40 text-slate-400 border border-white/5">
                      {zone.laneDirection}
                    </span>
                  </div>

                  {/* Hotspot Pulse Badge for Severe Choke Points */}
                  {isSevere && (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                    </span>
                  )}
                </div>

                {/* Center Value: Idle Duration */}
                <div className="flex items-baseline justify-between my-0.5">
                  <span className={`text-base font-mono tabular-nums ${style.text}`}>
                    {zone.idle_vehicle_minutes.toFixed(1)}m
                  </span>

                  {/* Heavy Vehicle Flag */}
                  {zone.heavy_vehicles_count > 0 && (
                    <span className="flex items-center gap-0.5 text-[9px] font-mono px-1 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-700/60 font-semibold" title={`${zone.heavy_vehicles_count} Heavy Vehicles`}>
                      <Bus className="h-2.5 w-2.5" />
                      {zone.heavy_vehicles_count}H
                    </span>
                  )}
                </div>

                {/* Footer: Vehicle Mix Icons & Queued Count */}
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-1 border-t border-white/10 w-full">
                  <span className="text-[9px] text-slate-400">
                    {zone.idling_vehicles_count} queued
                  </span>

                  {/* Small Vehicle Mix Icons */}
                  <div className="flex items-center gap-1">
                    {zone.vehicle_mix.bus > 0 && <span title="Bus">🚌</span>}
                    {zone.vehicle_mix.truck > 0 && <span title="Truck">🚛</span>}
                    {zone.vehicle_mix.auto_rickshaw > 0 && <span title="Auto">🛺</span>}
                    {zone.vehicle_mix.car > 0 && <span title="Car">🚗</span>}
                    {zone.vehicle_mix.motorcycle > 0 && <span title="Motorcycle">🛵</span>}
                  </div>
                </div>

                {/* Selected Ring Marker */}
                {isSelected && (
                  <div className="absolute inset-0 rounded-lg pointer-events-none ring-2 ring-emerald-400 ring-offset-1 ring-offset-[#090d16]" />
                )}
              </button>
            );
          })}
        </div>

        {/* Direction Bottom Label */}
        <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 px-1">
          <span className="flex items-center gap-1 text-slate-400">
            <ArrowLeft className="h-3 w-3" />
            West Cross Arterial
          </span>
          <span className="flex items-center gap-1 text-rose-400">
            <ArrowDown className="h-3 w-3" />
            South Corridor Discharge
          </span>
          <span className="flex items-center gap-1 text-slate-400">
            East Cross Arterial
            <ArrowRight className="h-3 w-3" />
          </span>
        </div>

      </div>

      {/* =====================================================================
          Hover / Click Popover & Deep Diagnostics Panel
          ===================================================================== */}
      {activeZone && (
        <div className="rounded-xl p-3.5 bg-[#0a0f1d] border border-sky-500/30 flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1f293d] pb-2">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-rose-400" />
              <span className="text-xs font-mono font-bold text-slate-100">
                {activeZone.label} ({activeZone.id}): {activeZone.name}
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-rose-950 text-rose-300 border border-rose-800">
                Lane {activeZone.laneDirection}
              </span>
            </div>

            <span className="text-[10px] font-mono text-emerald-400 font-semibold">
              Live Edge Diagnostics
            </span>
          </div>

          {/* 4 Detail Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
            {/* Metric 1: Total Idling Vehicles */}
            <div className="p-2 rounded-lg bg-[#111827] border border-[#1f293d]">
              <div className="text-[10px] text-slate-400 uppercase">Idling Vehicles</div>
              <div className="text-sm font-bold text-slate-100 mt-0.5 tabular-nums">
                {activeZone.idling_vehicles_count} units
              </div>
              <div className="text-[9px] text-slate-500 truncate" title={activeZone.unique_track_ids.join(', ')}>
                IDs: {activeZone.unique_track_ids.slice(0, 3).join(', ')}...
              </div>
            </div>

            {/* Metric 2: Heavy Vehicles */}
            <div className="p-2 rounded-lg bg-[#111827] border border-[#1f293d]">
              <div className="text-[10px] text-slate-400 uppercase">Heavy Vehicles</div>
              <div className="text-sm font-bold text-amber-400 mt-0.5 tabular-nums flex items-center gap-1">
                <Bus className="h-3 w-3" />
                {activeZone.heavy_vehicles_count} Buses/Trucks
              </div>
              <div className="text-[9px] text-slate-500">High start-stop inertia</div>
            </div>

            {/* Metric 3: Top Idling Class */}
            <div className="p-2 rounded-lg bg-[#111827] border border-[#1f293d]">
              <div className="text-[10px] text-slate-400 uppercase">Top Idling Class</div>
              <div className="text-sm font-bold text-cyan-300 mt-0.5 tabular-nums">
                {activeZone.top_idling_class}
              </div>
              <div className="text-[9px] text-cyan-400/80">
                {activeZone.top_idling_class_pct}% of cell mix
              </div>
            </div>

            {/* Metric 4: Estimated Excess CO2 */}
            <div className="p-2 rounded-lg bg-[#111827] border border-rose-900/50">
              <div className="text-[10px] text-slate-400 uppercase">Excess Idle CO₂</div>
              <div className="text-sm font-bold text-rose-400 mt-0.5 tabular-nums flex items-center gap-1">
                <Flame className="h-3 w-3 text-rose-500" />
                +{activeZone.estimated_excess_idle_co2_g.toFixed(0)} g
              </div>
              <div className="text-[9px] text-slate-500">Cumulative excess</div>
            </div>
          </div>

          {/* Vehicle Mix Distribution Bar */}
          <div className="flex flex-col gap-1 pt-1 border-t border-white/5">
            <div className="flex justify-between text-[10px] font-mono text-slate-400">
              <span>Taxonomy Distribution:</span>
              <span className="text-slate-300">
                🚗 {activeZone.vehicle_mix.car}% • 🛵 {activeZone.vehicle_mix.motorcycle}% • 🛺 {activeZone.vehicle_mix.auto_rickshaw}% • 🚌 {activeZone.vehicle_mix.bus}% • 🚛 {activeZone.vehicle_mix.truck}%
              </span>
            </div>
            <div className="h-1.5 w-full bg-[#1e293b] rounded-full overflow-hidden flex">
              <div style={{ width: `${activeZone.vehicle_mix.car}%` }} className="bg-sky-400 h-full" title="Car" />
              <div style={{ width: `${activeZone.vehicle_mix.motorcycle}%` }} className="bg-purple-400 h-full" title="2W" />
              <div style={{ width: `${activeZone.vehicle_mix.auto_rickshaw}%` }} className="bg-yellow-400 h-full" title="Auto" />
              <div style={{ width: `${activeZone.vehicle_mix.bus}%` }} className="bg-orange-500 h-full" title="Bus" />
              <div style={{ width: `${activeZone.vehicle_mix.truck}%` }} className="bg-rose-500 h-full" title="Truck" />
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          Top Choke Points Ranked Leaderboard
          ===================================================================== */}
      <div className="flex flex-col gap-2 pt-1 border-t border-[#1f293d]">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-rose-400" />
            Top 3 Municipal Choke Points
          </span>
          <span className="text-[10px] text-slate-500">One-click focus navigation</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {top3ChokeZones.map((zone, idx) => {
            const isFocused = selectedZoneId === zone.id;
            const rankMedal = idx === 0 ? '🥇 #1' : idx === 1 ? '🥈 #2' : '🥉 #3';

            return (
              <button
                key={zone.id}
                onClick={() => handleFocusRankedZone(zone)}
                className={`p-2.5 rounded-lg border text-left transition-all flex items-center justify-between cursor-pointer ${
                  isFocused
                    ? 'bg-rose-950/60 border-rose-500 ring-1 ring-rose-500 shadow-md'
                    : 'bg-[#090d16] border-[#1f293d] hover:border-slate-600'
                }`}
              >
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono font-bold text-amber-400">
                      {rankMedal}
                    </span>
                    <span className="text-xs font-mono font-black text-slate-100">
                      {zone.label}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 truncate max-w-[130px]">
                    {zone.name}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs font-mono font-bold text-rose-400 tabular-nums">
                    {zone.idle_vehicle_minutes.toFixed(1)}m
                  </div>
                  <div className="text-[9px] font-mono text-slate-500">
                    {zone.heavy_vehicles_count}H vehs
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

    </div>
  );
};
