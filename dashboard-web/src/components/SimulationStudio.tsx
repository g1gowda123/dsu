'use client';

import React, { useState } from 'react';
import { SimulationParams, VehicleClass } from '@/types/dashboard';
import { computeSimulation, EMISSION_FACTORS } from '@/data/mockData';
import {
  Sliders,
  TrendingDown,
  Coins,
  TreePine,
  Sparkles,
  RotateCcw,
  Shield,
  Zap,
  ArrowRight,
  Flame,
  Check,
} from 'lucide-react';

interface SimulationStudioProps {
  params: SimulationParams;
  onChangeParams: (newParams: SimulationParams) => void;
  baselineCo2: number;
}

export const SimulationStudio: React.FC<SimulationStudioProps> = ({
  params,
  onChangeParams,
  baselineCo2,
}) => {
  const [activePreset, setActivePreset] = useState<string>('custom');

  const results = computeSimulation(params, baselineCo2);

  const handleEvChange = (cls: VehicleClass, value: number) => {
    setActivePreset('custom');
    onChangeParams({
      ...params,
      evPenetration: {
        ...params.evPenetration,
        [cls]: value,
      },
    });
  };

  const handleGreenChange = (seconds: number) => {
    setActivePreset('custom');
    onChangeParams({
      ...params,
      adaptiveGreenExtensionSec: seconds,
    });
  };

  const handleHeavyToggle = () => {
    setActivePreset('custom');
    onChangeParams({
      ...params,
      heavyVehiclePeakRestriction: !params.heavyVehiclePeakRestriction,
    });
  };

  // Presets
  const applyPreset = (presetKey: string) => {
    setActivePreset(presetKey);
    if (presetKey === 'reset') {
      onChangeParams({
        evPenetration: { car: 0, motorcycle: 0, auto_rickshaw: 0, bus: 0, truck: 0 },
        adaptiveGreenExtensionSec: 0,
        heavyVehiclePeakRestriction: false,
        fuelPriceInr: 100,
      });
    } else if (presetKey === 'peak_decongest') {
      onChangeParams({
        evPenetration: { car: 10, motorcycle: 15, auto_rickshaw: 20, bus: 5, truck: 0 },
        adaptiveGreenExtensionSec: 12,
        heavyVehiclePeakRestriction: true,
        fuelPriceInr: 100,
      });
    } else if (presetKey === 'electric_2w') {
      onChangeParams({
        evPenetration: { car: 15, motorcycle: 100, auto_rickshaw: 60, bus: 10, truck: 0 },
        adaptiveGreenExtensionSec: 6,
        heavyVehiclePeakRestriction: false,
        fuelPriceInr: 100,
      });
    } else if (presetKey === 'transit_modern') {
      onChangeParams({
        evPenetration: { car: 20, motorcycle: 25, auto_rickshaw: 100, bus: 100, truck: 15 },
        adaptiveGreenExtensionSec: 10,
        heavyVehiclePeakRestriction: true,
        fuelPriceInr: 100,
      });
    } else if (presetKey === 'net_zero_2030') {
      onChangeParams({
        evPenetration: { car: 100, motorcycle: 100, auto_rickshaw: 100, bus: 100, truck: 100 },
        adaptiveGreenExtensionSec: 15,
        heavyVehiclePeakRestriction: true,
        fuelPriceInr: 100,
      });
    }
  };

  const formatINR = (val: number) => {
    if (val >= 10000000) {
      return `₹${(val / 10000000).toFixed(2)} Cr`;
    }
    if (val >= 100000) {
      return `₹${(val / 100000).toFixed(2)} Lakh`;
    }
    return `₹${val.toLocaleString('en-IN')}`;
  };

  return (
    <div className="command-card rounded-xl p-5 flex flex-col gap-4 border border-[#1f293d]">
      
      {/* Studio Title Bar & Quick Presets */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1f293d] pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            <Sliders className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-slate-100 flex items-center gap-2">
              What-If Policy Simulation Studio
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800">
                Vectorized Recompute &lt; 0.1s
              </span>
            </h3>
            <p className="text-xs text-slate-400 font-mono">
              Simulate counterfactual EV electrification, signal phase extensions, and freight perimeter diversions.
            </p>
          </div>
        </div>

        {/* Preset Selector */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono">
          <span className="text-slate-500 text-[11px] mr-1">Presets:</span>
          {[
            { id: 'peak_decongest', label: 'Morning De-congest' },
            { id: 'electric_2w', label: '100% EV 2-Wheeler' },
            { id: 'transit_modern', label: 'EV Bus & Auto Fleet' },
            { id: 'net_zero_2030', label: 'Net-Zero 2030' },
            { id: 'reset', label: 'Reset Baseline' },
          ].map((preset) => (
            <button
              key={preset.id}
              onClick={() => applyPreset(preset.id)}
              className={`px-2.5 py-1 rounded text-[11px] transition-all cursor-pointer ${
                activePreset === preset.id
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 font-bold'
                  : 'bg-[#111827] text-slate-400 border border-[#1f293d] hover:text-slate-200'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Studio Grid: Left Controls (60%), Right Impact Results (40%) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* Left Column (7 cols): Sliders & Controls */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          
          {/* Section: EV Fleet Penetration Sliders */}
          <div className="flex flex-col gap-2.5">
            <div className="text-xs font-mono uppercase tracking-wider text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-amber-400" />
                Fleet Electrification Penetration (%)
              </span>
              <span className="text-[10px] text-slate-500">Tailpipe Carbon = 0 g/km</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(
                [
                  { key: 'car', label: 'Passenger Car', icon: '🚗', color: 'accent-sky-500' },
                  { key: 'motorcycle', label: 'Motorcycle / Scooter', icon: '🛵', color: 'accent-purple-500' },
                  { key: 'auto_rickshaw', label: 'Auto-Rickshaw (3W)', icon: '🛺', color: 'accent-yellow-500' },
                  { key: 'bus', label: 'Transit Bus (BMTC)', icon: '🚌', color: 'accent-orange-500' },
                  { key: 'truck', label: 'Heavy Goods Truck', icon: '🚛', color: 'accent-red-500' },
                ] as { key: VehicleClass; label: string; icon: string; color: string }[]
              ).map((item) => {
                const val = params.evPenetration[item.key];
                return (
                  <div
                    key={item.key}
                    className="p-2.5 rounded-lg bg-[#0e1422] border border-[#1f293d] flex flex-col gap-1.5"
                  >
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-slate-300 flex items-center gap-1.5">
                        <span>{item.icon}</span>
                        <span>{item.label}</span>
                      </span>
                      <span className="font-bold text-emerald-400 tabular-nums">
                        {val}% EV
                      </span>
                    </div>

                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={val}
                      onChange={(e) => handleEvChange(item.key, Number(e.target.value))}
                      className="w-full h-1.5 bg-[#1a2333] rounded-lg appearance-none cursor-pointer accent-emerald-500 focus:outline-none"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section: Operational Interventions (Green Extension & Heavy Restriction) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-[#1f293d]">
            
            {/* Adaptive Green Slider */}
            <div className="p-3 rounded-lg bg-[#0e1422] border border-[#1f293d] flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs font-mono mb-1.5">
                <span className="text-slate-300">Adaptive Green Extension</span>
                <span className="font-bold text-amber-400 tabular-nums">
                  +{params.adaptiveGreenExtensionSec} sec
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="15"
                step="1"
                value={params.adaptiveGreenExtensionSec}
                onChange={(e) => handleGreenChange(Number(e.target.value))}
                className="w-full h-1.5 bg-[#1a2333] rounded-lg appearance-none cursor-pointer accent-amber-500 focus:outline-none"
              />
              <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1">
                <span>0s (Standard)</span>
                <span>Max +15s (Anti-Idle)</span>
              </div>
            </div>

            {/* Heavy Vehicle Peak Restriction Toggle */}
            <div className="p-3 rounded-lg bg-[#0e1422] border border-[#1f293d] flex items-center justify-between">
              <div>
                <div className="text-xs font-mono font-semibold text-slate-200">
                  Freight Diversion Rule
                </div>
                <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                  Hold/Reroute freight &gt; 7.5T during peak
                </div>
              </div>

              <button
                onClick={handleHeavyToggle}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  params.heavyVehiclePeakRestriction ? 'bg-emerald-600' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    params.heavyVehiclePeakRestriction ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

          </div>

        </div>

        {/* Right Column (5 cols): Real-Time Abatement Ledger & Impact */}
        <div className="lg:col-span-5 flex flex-col justify-between p-4 rounded-xl bg-[#0b101c] border border-emerald-500/30 shadow-inner">
          
          <div>
            <div className="flex items-center justify-between border-b border-[#1f293d] pb-2 mb-3">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300">
                Real-Time Carbon Ledger
              </span>
              <span className="text-[10px] font-mono text-slate-500">
                Corridor 04 Simulation
              </span>
            </div>

            {/* Baseline vs Scenario Highlight Cards */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="p-2.5 rounded-lg bg-[#111827] border border-[#1f293d]">
                <div className="text-[10px] font-mono text-slate-400">BASELINE EMISSION</div>
                <div className="text-lg font-mono font-bold text-slate-300 tabular-nums">
                  {results.baselineCo2_kg.toFixed(2)}{' '}
                  <span className="text-xs font-normal text-slate-500">kg</span>
                </div>
                <div className="text-[9px] font-mono text-slate-500">Current 2-min window</div>
              </div>

              <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-500/40">
                <div className="text-[10px] font-mono text-emerald-400 font-medium">
                  SCENARIO EMISSION
                </div>
                <div className="text-lg font-mono font-bold text-emerald-300 tabular-nums">
                  {results.scenarioCo2_kg.toFixed(2)}{' '}
                  <span className="text-xs font-normal text-emerald-500">kg</span>
                </div>
                <div className="text-[9px] font-mono text-emerald-400/80">
                  {results.savingsCo2_kg > 0 ? `-${results.savingsCo2_kg.toFixed(2)} kg saved` : 'Identical to baseline'}
                </div>
              </div>
            </div>

            {/* Abatement Badge */}
            <div className="p-3 rounded-lg bg-[#131c2e] border border-[#1f293d] flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-emerald-400" />
                <span className="text-xs font-mono font-bold text-slate-200">
                  Carbon Abatement:
                </span>
              </div>
              <span className="text-base font-mono font-bold text-emerald-400 tabular-nums">
                {results.abatementPct > 0 ? `-${results.abatementPct}%` : '0.0%'}
              </span>
            </div>

            {/* Financial & Environmental Equivalences */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              
              {/* Annualized INR Fuel Savings */}
              <div className="p-3 rounded-lg bg-[#111827] border border-amber-500/30 flex flex-col justify-between">
                <div className="flex items-center gap-1.5 text-amber-400 text-xs font-mono font-bold mb-1">
                  <Coins className="h-4 w-4" />
                  <span>Annual Fuel Savings</span>
                </div>
                <div className="text-base font-mono font-bold text-amber-300 tabular-nums">
                  {formatINR(results.annualizedInrSavings)}
                </div>
                <div className="text-[9px] font-mono text-slate-500 mt-1">
                  At ₹100/L diesel & petrol
                </div>
              </div>

              {/* Tree Equivalence */}
              <div className="p-3 rounded-lg bg-[#111827] border border-emerald-500/30 flex flex-col justify-between">
                <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-mono font-bold mb-1">
                  <TreePine className="h-4 w-4" />
                  <span>Trees Equivalence</span>
                </div>
                <div className="text-base font-mono font-bold text-emerald-300 tabular-nums">
                  {results.equivalentTreesPlanted.toLocaleString()}
                </div>
                <div className="text-[9px] font-mono text-slate-500 mt-1">
                  ~21.8 kg CO₂/tree/yr
                </div>
              </div>

            </div>

            {/* Class Breakdown Progress Bars */}
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                Abatement By Vehicle Taxonomy
              </div>
              {results.breakdownByClass.map((item) => (
                <div key={item.classType} className="flex flex-col gap-0.5 text-[10px] font-mono">
                  <div className="flex justify-between text-slate-300">
                    <span>{item.label}</span>
                    <span className="text-emerald-400 font-bold tabular-nums">
                      {item.scenario.toFixed(2)} kg ({item.deltaPct}%)
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-[#1a2333] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.max(5, (item.scenario / item.baseline) * 100)}%`,
                        backgroundColor: item.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

          </div>

        </div>

      </div>

    </div>
  );
};
