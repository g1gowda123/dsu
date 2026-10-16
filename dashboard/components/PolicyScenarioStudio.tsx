import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
  Cell,
} from 'recharts';
import {
  Zap,
  TrendingDown,
  DollarSign,
  Trees,
  RotateCcw,
  FileText,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Truck,
  Bus,
  Car,
  Bike,
  Sparkles,
  Download,
  Printer,
  ChevronRight,
  Info,
  Shield,
  Layers,
  ArrowUpRight,
} from 'lucide-react';

/* =========================================================================
   TYPE DEFINITIONS & CONSTANTS
   ========================================================================= */

export type VehicleClassKey = 'motorcycle' | 'auto_rickshaw' | 'car' | 'bus' | 'truck';

export interface VehicleClassConfig {
  key: VehicleClassKey;
  label: string;
  shortLabel: string;
  defaultEVShare: number; // in percent (0 - 100)
  baselineGrams: number;  // baseline emissions in grams
  idleShare: number;      // fraction of emissions originating from idle (0 - 1)
  color: string;
  textColor: string;
  bgLight: string;
  borderColor: string;
}

export interface EVAdoptionState {
  motorcycle: number;
  auto_rickshaw: number;
  car: number;
  bus: number;
  truck: number;
}

export interface SignalPolicyState {
  greenExtensionSeconds: number; // 0 to 15 seconds
  heavyVehiclePriority: boolean; // 65% reduction in heavy idle
}

export interface ClassBreakdownResult {
  key: VehicleClassKey;
  label: string;
  baselineKg: number;
  scenarioKg: number;
  avoidedKg: number;
  abatementPercent: number;
  inrSaved: number;
  evShare: number;
}

export interface PolicyScenarioResults {
  baselineTotalKg: number;
  scenarioTotalKg: number;
  avoidedTotalKg: number;
  abatementPercent: number;
  litersFuelSaved: number;
  inrSavedCycle: number;
  annualizedInrSavedLakhs: number;
  annualizedAvoidedKg: number;
  treeEquivalentsAnnual: number;
  perClass: Record<VehicleClassKey, ClassBreakdownResult>;
}

export interface PolicyScenarioStudioProps {
  /** Optional custom baseline in kg (defaults to 150.0 kg) */
  initialBaselineKg?: number;
  /** Fuel price in INR per Liter (defaults to ₹100 / L) */
  fuelPriceInr?: number;
  /** Annualization multiplier from representative operational cycle (default: 450 peak hours/year) */
  annualizationFactor?: number;
  /** Municipal junction or corridor name */
  junctionName?: string;
  /** Callback fired whenever scenario calculation updates */
  onScenarioChange?: (results: PolicyScenarioResults) => void;
  /** Extra CSS classes */
  className?: string;
}

// 5-class Indian urban taxonomy with baseline weights summing to 150 kg (150,000 g)
export const VEHICLE_CLASSES: VehicleClassConfig[] = [
  {
    key: 'motorcycle',
    label: '2-Wheelers / Motorcycles',
    shortLabel: '2-Wheeler',
    defaultEVShare: 30,
    baselineGrams: 27000, // 27.0 kg (18%)
    idleShare: 0.40,
    color: '#38bdf8', // sky-400
    textColor: 'text-sky-400',
    bgLight: 'bg-sky-500/10',
    borderColor: 'border-sky-500/30',
  },
  {
    key: 'auto_rickshaw',
    label: 'Auto-Rickshaws (3W)',
    shortLabel: 'Auto-Rickshaw',
    defaultEVShare: 25,
    baselineGrams: 22500, // 22.5 kg (15%)
    idleShare: 0.45,
    color: '#fbbf24', // amber-400
    textColor: 'text-amber-400',
    bgLight: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
  },
  {
    key: 'car',
    label: 'Passenger Cars (4W)',
    shortLabel: 'Passenger Car',
    defaultEVShare: 20,
    baselineGrams: 52500, // 52.5 kg (35%)
    idleShare: 0.42,
    color: '#818cf8', // indigo-400
    textColor: 'text-indigo-400',
    bgLight: 'bg-indigo-500/10',
    borderColor: 'border-indigo-500/30',
  },
  {
    key: 'bus',
    label: 'City Transit Buses',
    shortLabel: 'Transit Bus',
    defaultEVShare: 40,
    baselineGrams: 30000, // 30.0 kg (20%)
    idleShare: 0.50,
    color: '#34d399', // emerald-400
    textColor: 'text-emerald-400',
    bgLight: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
  },
  {
    key: 'truck',
    label: 'Commercial Trucks',
    shortLabel: 'Comm. Truck',
    defaultEVShare: 10,
    baselineGrams: 18000, // 18.0 kg (12%)
    idleShare: 0.48,
    color: '#f87171', // red-400
    textColor: 'text-red-400',
    bgLight: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
  },
];

export const DEFAULT_EV_STATE: EVAdoptionState = {
  motorcycle: 30,
  auto_rickshaw: 25,
  car: 20,
  bus: 40,
  truck: 10,
};

export const DEFAULT_SIGNAL_STATE: SignalPolicyState = {
  greenExtensionSeconds: 6,
  heavyVehiclePriority: true,
};

/* =========================================================================
   ANIMATED VALUE HOOK
   ========================================================================= */

function useAnimatedNumber(targetValue: number, durationMs = 400): number {
  const [currentValue, setCurrentValue] = useState<number>(targetValue);
  const startRef = useRef<number>(targetValue);
  const targetRef = useRef<number>(targetValue);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    startRef.current = currentValue;
    targetRef.current = targetValue;
    startTimeRef.current = null;

    let animId: number;
    const animate = (timestamp: number) => {
      if (startTimeRef.current === null) startTimeRef.current = timestamp;
      const progress = Math.min((timestamp - startTimeRef.current) / durationMs, 1);
      // Ease-out cubic
      const ease = 1 - Math.pow(1 - progress, 3);
      const next = startRef.current + (targetRef.current - startRef.current) * ease;
      setCurrentValue(next);

      if (progress < 1) {
        animId = requestAnimationFrame(animate);
      }
    };

    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, [targetValue, durationMs]);

  return currentValue;
}

/* =========================================================================
   MAIN COMPONENT: PolicyScenarioStudio
   ========================================================================= */

export const PolicyScenarioStudio: React.FC<PolicyScenarioStudioProps> = ({
  initialBaselineKg = 150.0,
  fuelPriceInr = 100.0,
  annualizationFactor = 450, // 450 representative corridor hours/year
  junctionName = 'DELHI-ND-J04 // CONNAUGHT OUTER RING',
  onScenarioChange,
  className = '',
}) => {
  // Intervention state
  const [evShare, setEvShare] = useState<EVAdoptionState>(DEFAULT_EV_STATE);
  const [signalPolicy, setSignalPolicy] = useState<SignalPolicyState>(DEFAULT_SIGNAL_STATE);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [activePreset, setActivePreset] = useState<string>('Custom');

  // Scale factor if custom baselineKg provided
  const scaleRatio = initialBaselineKg / 150.0;

  // =========================================================================
  // VECTORIZED SCENARIO CALCULATION ENGINE
  // =========================================================================
  const results: PolicyScenarioResults = useMemo(() => {
    let baselineSumGrams = 0;
    let scenarioSumGrams = 0;
    const perClass: Record<string, ClassBreakdownResult> = {};

    VEHICLE_CLASSES.forEach((clsConfig) => {
      const classBaselineGrams = clsConfig.baselineGrams * scaleRatio;
      const evPercent = evShare[clsConfig.key];

      // 1. Idle fraction of emissions
      const idleGrams = classBaselineGrams * clsConfig.idleShare;
      const cruiseGrams = classBaselineGrams - idleGrams;

      // 2. Signal policy reduction on idle emissions
      let idleReductionRate = signalPolicy.greenExtensionSeconds * 0.032; // ~3.2% per second

      // Heavy priority wave cuts heavy vehicle idle by 65%
      if (
        (clsConfig.key === 'bus' || clsConfig.key === 'truck') &&
        signalPolicy.heavyVehiclePriority
      ) {
        idleReductionRate = Math.max(idleReductionRate, 0.65);
      }
      idleReductionRate = Math.min(1.0, idleReductionRate);

      const adjustedIdleGrams = idleGrams * (1 - idleReductionRate);
      const postSignalICEGrams = adjustedIdleGrams + cruiseGrams;

      // 3. EV adoption eliminates tailpipe emissions for the electrified fraction
      const scenarioGrams = postSignalICEGrams * (1 - evPercent / 100);
      const avoidedGrams = Math.max(0, classBaselineGrams - scenarioGrams);

      baselineSumGrams += classBaselineGrams;
      scenarioSumGrams += scenarioGrams;

      const baselineKg = classBaselineGrams / 1000;
      const scenarioKg = scenarioGrams / 1000;
      const avoidedKg = avoidedGrams / 1000;
      const inrSavedClass = (avoidedGrams / 2300) * fuelPriceInr;

      perClass[clsConfig.key] = {
        key: clsConfig.key,
        label: clsConfig.label,
        baselineKg: Number(baselineKg.toFixed(2)),
        scenarioKg: Number(scenarioKg.toFixed(2)),
        avoidedKg: Number(avoidedKg.toFixed(2)),
        abatementPercent: Number(((avoidedGrams / Math.max(1, classBaselineGrams)) * 100).toFixed(1)),
        inrSaved: Number(inrSavedClass.toFixed(2)),
        evShare: evPercent,
      };
    });

    const baselineTotalKg = baselineSumGrams / 1000;
    const scenarioTotalKg = scenarioSumGrams / 1000;
    const avoidedTotalKg = Math.max(0, baselineTotalKg - scenarioTotalKg);
    const abatementPercent = (avoidedTotalKg / Math.max(0.1, baselineTotalKg)) * 100;

    // Economic & ecological equivalencies:
    // 1 Liter petrol/diesel ≈ 2,300 g CO2
    const totalAvoidedGrams = avoidedTotalKg * 1000;
    const litersFuelSaved = totalAvoidedGrams / 2300;
    const inrSavedCycle = litersFuelSaved * fuelPriceInr;

    // Annualized figures
    const annualizedInr = inrSavedCycle * annualizationFactor;
    const annualizedInrSavedLakhs = annualizedInr / 100000; // 1 Lakh = 100,000 INR
    const annualizedAvoidedKg = avoidedTotalKg * annualizationFactor;
    // 1 mature tree absorbs ~21 kg CO2/year
    const treeEquivalentsAnnual = Math.round(annualizedAvoidedKg / 21);

    return {
      baselineTotalKg: Number(baselineTotalKg.toFixed(1)),
      scenarioTotalKg: Number(scenarioTotalKg.toFixed(1)),
      avoidedTotalKg: Number(avoidedTotalKg.toFixed(1)),
      abatementPercent: Number(abatementPercent.toFixed(1)),
      litersFuelSaved: Number(litersFuelSaved.toFixed(1)),
      inrSavedCycle: Number(inrSavedCycle.toFixed(0)),
      annualizedInrSavedLakhs: Number(annualizedInrSavedLakhs.toFixed(2)),
      annualizedAvoidedKg: Number(annualizedAvoidedKg.toFixed(0)),
      treeEquivalentsAnnual,
      perClass: perClass as Record<VehicleClassKey, ClassBreakdownResult>,
    };
  }, [evShare, signalPolicy, scaleRatio, fuelPriceInr, annualizationFactor]);

  // Notify parent component on update
  useEffect(() => {
    onScenarioChange?.(results);
  }, [results, onScenarioChange]);

  // Smooth animated counter values
  const animatedAbatement = useAnimatedNumber(results.abatementPercent);
  const animatedAvoidedKg = useAnimatedNumber(results.avoidedTotalKg);
  const animatedLakhs = useAnimatedNumber(results.annualizedInrSavedLakhs);
  const animatedTrees = useAnimatedNumber(results.treeEquivalentsAnnual);

  // =========================================================================
  // HANDLERS & PRESETS
  // =========================================================================
  const handleEVChange = (key: VehicleClassKey, value: number) => {
    setActivePreset('Custom');
    setEvShare((prev) => ({ ...prev, [key]: value }));
  };

  const handleResetToBaseline = () => {
    setActivePreset('Baseline');
    setEvShare({
      motorcycle: 0,
      auto_rickshaw: 0,
      car: 0,
      bus: 0,
      truck: 0,
    });
    setSignalPolicy({
      greenExtensionSeconds: 0,
      heavyVehiclePriority: false,
    });
  };

  const handleApplyDefaultPreset = () => {
    setActivePreset('National Default');
    setEvShare(DEFAULT_EV_STATE);
    setSignalPolicy(DEFAULT_SIGNAL_STATE);
  };

  const handleApplyPresetFAME = () => {
    setActivePreset('FAME-II Transit First');
    setEvShare({
      motorcycle: 45,
      auto_rickshaw: 60,
      car: 25,
      bus: 80,
      truck: 20,
    });
    setSignalPolicy({
      greenExtensionSeconds: 10,
      heavyVehiclePriority: true,
    });
  };

  const handleApplyPresetNetZero = () => {
    setActivePreset('Corridor 2035 Net Zero');
    setEvShare({
      motorcycle: 85,
      auto_rickshaw: 90,
      car: 70,
      bus: 100,
      truck: 60,
    });
    setSignalPolicy({
      greenExtensionSeconds: 15,
      heavyVehiclePriority: true,
    });
  };

  // Bar chart dataset preparation
  const chartData = useMemo(() => {
    return VEHICLE_CLASSES.map((cls) => {
      const item = results.perClass[cls.key];
      return {
        name: cls.shortLabel,
        fullName: cls.label,
        Baseline: item.baselineKg,
        Scenario: item.scenarioKg,
        Avoided: item.avoidedKg,
        Abatement: item.abatementPercent,
        color: cls.color,
      };
    });
  }, [results]);

  // Icon selector
  const getClassIcon = (key: VehicleClassKey) => {
    switch (key) {
      case 'motorcycle':
        return <Bike className="w-4 h-4 text-sky-400" />;
      case 'auto_rickshaw':
        return <Zap className="w-4 h-4 text-amber-400" />;
      case 'car':
        return <Car className="w-4 h-4 text-indigo-400" />;
      case 'bus':
        return <Bus className="w-4 h-4 text-emerald-400" />;
      case 'truck':
        return <Truck className="w-4 h-4 text-red-400" />;
    }
  };

  // Export JSON Report handler
  const handleDownloadJSON = () => {
    const reportData = {
      title: 'Municipal Traffic Carbon Digital Twin — Policy Scenario Simulation Brief',
      timestamp: new Date().toISOString(),
      corridor: junctionName,
      assumptions: {
        baselineKg: results.baselineTotalKg,
        fuelPriceInrPerLiter: fuelPriceInr,
        co2GramsPerLiter: 2300,
        treeAbsorptionKgPerYear: 21,
        annualizationPeakHours: annualizationFactor,
      },
      policyInputs: {
        evAdoptionPercent: evShare,
        signalPolicy,
      },
      impactSummary: {
        abatementPercentage: `${results.abatementPercent}%`,
        avoidedCarbonKg: results.avoidedTotalKg,
        annualizedCarbonAvoidedKg: results.annualizedAvoidedKg,
        annualizedFuelSavingsINR: `₹ ${results.annualizedInrSavedLakhs} Lakhs`,
        matureTreesPlantedEquivalent: results.treeEquivalentsAnnual,
      },
      classBreakdown: results.perClass,
    };

    const blob = new Blob([jsonString(reportData)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `policy_brief_${junctionName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const jsonString = (data: any) => JSON.stringify(data, null, 2);

  return (
    <div
      className={`w-full max-w-7xl mx-auto rounded-2xl bg-slate-950 border border-slate-800 shadow-2xl text-slate-100 font-sans overflow-hidden ${className}`}
    >
      {/* =====================================================================
          1. HEADER BAR: TITLE, PRESETS & EXPORT BUTTON
          ===================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 bg-slate-900/90 border-b border-slate-800/80 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-sky-500/20 border border-emerald-500/40 text-emerald-400 shadow-md">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight text-white">
                Policy Scenario Studio
              </h2>
              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-500/30">
                WHAT-IF DIGITAL TWIN
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              {junctionName} // REAL-TIME VECTORIZED ABATEMENT ENGINE
            </p>
          </div>
        </div>

        {/* Policy Presets & Export Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Preset Buttons */}
          <div className="hidden lg:flex items-center gap-1.5 p-1 rounded-lg bg-slate-950 border border-slate-800 text-xs">
            <span className="text-slate-500 px-2 font-mono text-[11px]">Presets:</span>
            <button
              onClick={handleApplyDefaultPreset}
              className={`px-2.5 py-1 rounded transition-colors font-medium ${
                activePreset === 'National Default'
                  ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              Default FAME
            </button>
            <button
              onClick={handleApplyPresetFAME}
              className={`px-2.5 py-1 rounded transition-colors font-medium ${
                activePreset === 'FAME-II Transit First'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              Transit First
            </button>
            <button
              onClick={handleApplyPresetNetZero}
              className={`px-2.5 py-1 rounded transition-colors font-medium ${
                activePreset === 'Corridor 2035 Net Zero'
                  ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              Net-Zero 2035
            </button>
          </div>

          {/* Reset Button */}
          <button
            onClick={handleResetToBaseline}
            title="Reset all EV and signal policies to zero intervention baseline"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 text-xs font-medium transition-all border border-slate-700/70"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Baseline</span>
          </button>

          {/* Export Municipal Policy Brief Modal Trigger */}
          <button
            onClick={() => setShowExportModal(true)}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
          >
            <FileText className="w-4 h-4" />
            <span>Generate Policy Brief</span>
          </button>
        </div>
      </div>

      {/* =====================================================================
          2. MAIN 2-COLUMN STUDIO WORKSPACE
          ===================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-6">
        {/* ===================================================================
            LEFT COLUMN: POLICY INTERVENTION CONTROLS (5 COLS)
            =================================================================== */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          {/* Section 1: Fleet Electrification Sliders */}
          <div className="p-5 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold tracking-wide text-slate-200 uppercase font-mono">
                  Fleet Electrification (EV %)
                </h3>
              </div>
              <span className="text-[11px] font-mono text-slate-500">
                0% = Pure ICE · 100% = 0g Tailpipe
              </span>
            </div>

            <div className="flex flex-col gap-4">
              {VEHICLE_CLASSES.map((cls) => {
                const currentVal = evShare[cls.key];
                return (
                  <div key={cls.key} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        {getClassIcon(cls.key)}
                        <span className="font-semibold text-slate-300">
                          {cls.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-500 font-mono">
                          ({(results.perClass[cls.key].baselineKg).toFixed(1)} kg)
                        </span>
                        <span
                          className={`font-mono font-bold px-2 py-0.5 rounded text-xs border ${cls.bgLight} ${cls.textColor} ${cls.borderColor}`}
                        >
                          {currentVal}% EV
                        </span>
                      </div>
                    </div>

                    <div className="relative flex items-center">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={currentVal}
                        onChange={(e) => handleEVChange(cls.key, parseInt(e.target.value, 10))}
                        className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-400 hover:accent-emerald-300 transition-all"
                        aria-label={`${cls.label} EV Percentage`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 2: Adaptive Signal & Corridor Policy Controls */}
          <div className="p-5 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-bold tracking-wide text-slate-200 uppercase font-mono">
                  Adaptive Signal & Queue Policy
                </h3>
              </div>
              <span className="text-[11px] font-mono text-slate-500">
                Choke Mitigation
              </span>
            </div>

            {/* Slider: Adaptive Green Extension */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold text-slate-200">
                    Adaptive Green Extension
                  </span>
                  <p className="text-[11px] text-slate-400">
                    Reduces queue idle duration by ~3.2% per second
                  </p>
                </div>
                <span className="font-mono font-bold px-2.5 py-1 rounded-md bg-sky-950/80 text-sky-400 border border-sky-500/30 text-xs">
                  +{signalPolicy.greenExtensionSeconds}s (
                  -{(signalPolicy.greenExtensionSeconds * 3.2).toFixed(1)}% idle)
                </span>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-[11px] font-mono text-slate-500">0s</span>
                <input
                  type="range"
                  min={0}
                  max={15}
                  step={1}
                  value={signalPolicy.greenExtensionSeconds}
                  onChange={(e) => {
                    setActivePreset('Custom');
                    setSignalPolicy((p) => ({
                      ...p,
                      greenExtensionSeconds: parseInt(e.target.value, 10),
                    }));
                  }}
                  className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-400 hover:accent-sky-300 transition-all"
                  aria-label="Adaptive Green Extension Seconds"
                />
                <span className="text-[11px] font-mono text-slate-500">15s</span>
              </div>
            </div>

            {/* Toggle: Heavy Vehicle Priority Wave */}
            <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-slate-200">
                  Heavy Vehicle Priority Wave
                </span>
                <span className="text-[11px] text-slate-400">
                  Grants green corridor for buses & trucks (-65% heavy idle)
                </span>
              </div>

              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={signalPolicy.heavyVehiclePriority}
                  onChange={(e) => {
                    setActivePreset('Custom');
                    setSignalPolicy((p) => ({
                      ...p,
                      heavyVehiclePriority: e.target.checked,
                    }));
                  }}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
              </label>
            </div>
          </div>
        </div>

        {/* ===================================================================
            RIGHT COLUMN: IMPACT RESULTS & VISUALIZATIONS (7 COLS)
            =================================================================== */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          {/* =================================================================
              3 BIG KPI COUNTERS (SMOOTH ANIMATED TRANSITIONS)
              ================================================================= */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* KPI 1: Carbon Abatement */}
            <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-900 border border-emerald-500/30 shadow-lg relative overflow-hidden group">
              <div className="flex items-center justify-between text-xs text-emerald-400 font-mono font-semibold mb-1">
                <span>CARBON ABATEMENT</span>
                <TrendingDown className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
              </div>
              <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono tracking-tight">
                -{animatedAbatement.toFixed(1)}%
              </div>
              <div className="text-xs text-slate-400 font-mono mt-1 flex items-center gap-1">
                <span className="text-emerald-400 font-bold">
                  -{animatedAvoidedKg.toFixed(1)} kg CO2
                </span>
                <span>/ cycle</span>
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
                <div
                  style={{ width: `${Math.min(100, results.abatementPercent)}%` }}
                  className="h-full bg-emerald-400 transition-all duration-300 ease-out"
                />
              </div>
            </div>

            {/* KPI 2: Annualized Municipal Fuel Savings (INR) */}
            <div className="p-4 rounded-xl bg-gradient-to-br from-sky-950/40 via-slate-900 to-slate-900 border border-sky-500/30 shadow-lg relative overflow-hidden group">
              <div className="flex items-center justify-between text-xs text-sky-400 font-mono font-semibold mb-1">
                <span>MUNICIPAL SAVINGS</span>
                <DollarSign className="w-4 h-4 text-sky-400 group-hover:scale-110 transition-transform" />
              </div>
              <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono tracking-tight">
                ₹ {animatedLakhs.toFixed(1)} L
              </div>
              <div className="text-xs text-slate-400 font-mono mt-1 flex items-center gap-1">
                <span>Lakhs / year</span>
                <span className="text-sky-300 font-bold text-[11px]">
                  (@ ₹{fuelPriceInr}/L)
                </span>
              </div>
              <div className="text-[10px] text-slate-500 font-mono mt-2">
                Avoids ~{(results.litersFuelSaved * annualizationFactor).toLocaleString()} L fuel/yr
              </div>
            </div>

            {/* KPI 3: Ecological Equivalent (Mature Trees) */}
            <div className="p-4 rounded-xl bg-gradient-to-br from-teal-950/40 via-slate-900 to-slate-900 border border-teal-500/30 shadow-lg relative overflow-hidden group">
              <div className="flex items-center justify-between text-xs text-teal-400 font-mono font-semibold mb-1">
                <span>TREE EQUIVALENT</span>
                <Trees className="w-4 h-4 text-teal-400 group-hover:scale-110 transition-transform" />
              </div>
              <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono tracking-tight">
                {Math.round(animatedTrees).toLocaleString()}
              </div>
              <div className="text-xs text-slate-400 font-mono mt-1">
                Trees Planted / year
              </div>
              <div className="text-[10px] text-slate-500 font-mono mt-2">
                Based on 21 kg CO2/mature tree/yr
              </div>
            </div>
          </div>

          {/* =================================================================
              COMPARISON BAR CHART: BASELINE VS SCENARIO PER CLASS
              ================================================================= */}
          <div className="p-5 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold tracking-wide text-slate-200 uppercase font-mono">
                  Baseline vs Scenario Emissions (kg CO2)
                </h3>
              </div>
              <div className="flex items-center gap-4 text-xs font-mono">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-slate-600 inline-block" />
                  <span className="text-slate-400">Baseline</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-emerald-400 inline-block" />
                  <span className="text-emerald-400 font-bold">Scenario</span>
                </div>
              </div>
            </div>

            {/* Recharts Bar Chart Container */}
            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                  barGap={6}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis
                    dataKey="name"
                    stroke="#64748b"
                    fontSize={11}
                    fontFamily="monospace"
                    tickLine={false}
                  />
                  <YAxis
                    stroke="#64748b"
                    fontSize={11}
                    fontFamily="monospace"
                    tickLine={false}
                    unit=" kg"
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="p-3 bg-slate-900 border border-slate-700 rounded-lg shadow-xl font-mono text-xs text-slate-200">
                            <p className="font-bold text-white mb-1.5 border-b border-slate-700 pb-1">
                              {data.fullName}
                            </p>
                            <p className="text-slate-400">
                              Baseline: <span className="font-bold text-slate-200">{data.Baseline} kg</span>
                            </p>
                            <p className="text-emerald-400">
                              Scenario: <span className="font-bold text-emerald-300">{data.Scenario} kg</span>
                            </p>
                            <p className="text-sky-300 font-semibold mt-1">
                              Abatement: -{data.Abatement}% (-{data.Avoided} kg)
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar
                    dataKey="Baseline"
                    fill="#475569"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={36}
                  />
                  <Bar
                    dataKey="Scenario"
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={36}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Class Breakdown Mini-Audit Table */}
            <div className="overflow-x-auto pt-2">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 font-semibold">Class</th>
                    <th className="py-2 font-semibold">Baseline</th>
                    <th className="py-2 font-semibold">Scenario</th>
                    <th className="py-2 font-semibold">Avoided</th>
                    <th className="py-2 font-semibold">Abatement</th>
                    <th className="py-2 font-semibold text-right">Fuel Saved (INR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {VEHICLE_CLASSES.map((cls) => {
                    const row = results.perClass[cls.key];
                    return (
                      <tr key={cls.key} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-2 text-slate-200 font-medium flex items-center gap-1.5">
                          {getClassIcon(cls.key)}
                          <span>{cls.shortLabel}</span>
                        </td>
                        <td className="py-2 text-slate-400">{row.baselineKg} kg</td>
                        <td className="py-2 text-emerald-400 font-bold">{row.scenarioKg} kg</td>
                        <td className="py-2 text-slate-300">-{row.avoidedKg} kg</td>
                        <td className="py-2">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-500/20">
                            -{row.abatementPercent}%
                          </span>
                        </td>
                        <td className="py-2 text-right text-sky-400 font-bold">
                          ₹ {row.inrSaved.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================================
          3. MUNICIPAL POLICY BRIEF EXPORT MODAL (PREVIEW, PRINT & JSON)
          ===================================================================== */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 flex flex-col gap-5 text-slate-100">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white font-mono">
                  MUNICIPAL POLICY INTERVENTION BRIEF
                </h3>
              </div>
              <button
                onClick={() => setShowExportModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Printable Document Body */}
            <div id="printable-policy-brief" className="flex flex-col gap-5 text-xs font-mono">
              {/* Institutional Header */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex justify-between items-start">
                <div>
                  <h4 className="text-sm font-bold text-slate-100 uppercase">
                    Delhi Municipal Corporation // Traffic & Clean Air Directorate
                  </h4>
                  <p className="text-slate-400 text-[11px] mt-0.5">
                    Corridor: {junctionName}
                  </p>
                  <p className="text-slate-500 text-[10px] mt-1">
                    Generated: {new Date().toLocaleString()} // Eco-Kinetic Twin Engine v2.0
                  </p>
                </div>
                <div className="px-2.5 py-1 rounded bg-emerald-950 border border-emerald-500/40 text-emerald-400 font-bold text-[11px]">
                  APPROVED SCENARIO MODEL
                </div>
              </div>

              {/* Policy Inputs Applied */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3.5 rounded-lg bg-slate-950/80 border border-slate-800">
                  <span className="text-[11px] text-slate-400 uppercase font-bold block mb-2">
                    Fleet EV Targets
                  </span>
                  <div className="flex flex-col gap-1 text-[11px] text-slate-300">
                    <div>2-Wheelers: <span className="font-bold text-emerald-400">{evShare.motorcycle}%</span></div>
                    <div>Auto-Rickshaws: <span className="font-bold text-emerald-400">{evShare.auto_rickshaw}%</span></div>
                    <div>Passenger Cars: <span className="font-bold text-emerald-400">{evShare.car}%</span></div>
                    <div>Transit Buses: <span className="font-bold text-emerald-400">{evShare.bus}%</span></div>
                    <div>Commercial Trucks: <span className="font-bold text-emerald-400">{evShare.truck}%</span></div>
                  </div>
                </div>

                <div className="p-3.5 rounded-lg bg-slate-950/80 border border-slate-800">
                  <span className="text-[11px] text-slate-400 uppercase font-bold block mb-2">
                    Signal & Queue Intervention
                  </span>
                  <div className="flex flex-col gap-1 text-[11px] text-slate-300">
                    <div>
                      Adaptive Green Extension: <span className="font-bold text-sky-400">+{signalPolicy.greenExtensionSeconds}s</span>
                    </div>
                    <div>
                      Idle Abatement Factor: <span className="font-bold text-sky-400">-{(signalPolicy.greenExtensionSeconds * 3.2).toFixed(1)}%</span>
                    </div>
                    <div>
                      Heavy Priority Corridor: <span className="font-bold text-sky-400">{signalPolicy.heavyVehiclePriority ? 'ENABLED (-65% idle)' : 'DISABLED'}</span>
                    </div>
                    <div>Fuel Price Benchmark: ₹ {fuelPriceInr} / Liter</div>
                  </div>
                </div>
              </div>

              {/* Economic & Ecological Highlights */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-950/60 to-sky-950/60 border border-emerald-500/40 grid grid-cols-3 gap-3 text-center">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase block">Total Abatement</span>
                  <span className="text-xl font-bold text-emerald-400 font-mono">
                    -{results.abatementPercent}%
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    (-{results.avoidedTotalKg} kg CO2)
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase block">Annualized Fuel Saved</span>
                  <span className="text-xl font-bold text-sky-400 font-mono">
                    ₹ {results.annualizedInrSavedLakhs} Lakhs
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    ({(results.litersFuelSaved * annualizationFactor).toLocaleString()} Liters)
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase block">Ecological Equivalent</span>
                  <span className="text-xl font-bold text-teal-400 font-mono">
                    {results.treeEquivalentsAnnual.toLocaleString()} Trees
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    Sequestration / yr
                  </span>
                </div>
              </div>

              {/* Signoff Block */}
              <div className="pt-4 border-t border-slate-800 text-[11px] text-slate-400 flex justify-between items-center">
                <span>Methodology: CPCB BS-VI Multi-Class Driving Cycle Matrix</span>
                <span className="italic">Authorized by Municipal Transport Commission</span>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
              >
                <Printer className="w-4 h-4" />
                <span>Print PDF</span>
              </button>
              <button
                onClick={handleDownloadJSON}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-colors shadow-md shadow-emerald-500/20"
              >
                <Download className="w-4 h-4" />
                <span>Download JSON Brief</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PolicyScenarioStudio;
