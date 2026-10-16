import {
  data,
  EQUIVALENCE_FACTORS,
  VEHICLE_CLASSES,
  type VehicleClass,
} from "@/lib/data";

export interface Scenario {
  evShare: Record<VehicleClass, number>;
  greenExtensionS: number;
  heavyRestriction: boolean;
}

export const emptyScenario = (): Scenario => ({
  evShare: {
    car: 0,
    motorcycle: 0,
    auto_rickshaw: 0,
    bus: 0,
    truck: 0,
  },
  greenExtensionS: 0,
  heavyRestriction: false,
});

// Integrated session baseline from the emission-rate series.
const points = data.telemetry.points;
const baselineKgTotal =
  points.reduce((s, p) => s + (p.emissionRate_gs ?? 0), 0) *
  data.telemetry.intervalSec /
  1000;

// Per-class split from observed class emissions, rescaled to the
// integrated total (byClassEmission undercounts intervals with no sightings).
const rawClassKg: Record<VehicleClass, number> = (() => {
  const out = {} as Record<VehicleClass, number>;
  for (const k of VEHICLE_CLASSES) {
    const v = data.factors.perClassEmission_gs[k];
    out[k] = v !== null && v !== undefined ? v * data.telemetry.intervalSec / 1000 : 0;
  }
  return out;
})();

const rawSum = Object.values(rawClassKg).reduce((s, v) => s + v, 0) || 1;

const baselinePerClass: Record<VehicleClass, number> = (() => {
  const out = {} as Record<VehicleClass, number>;
  for (const k of VEHICLE_CLASSES) {
    out[k] = (rawClassKg[k] / rawSum) * baselineKgTotal;
  }
  return out;
})();

export const baselineKg = baselineKgTotal;

const idleShareFrac = (data.summary.idleSharePct ?? 0) / 100;
const windowSec = data.telemetry.spanSec;

const HEAVY_TRUCK_FACTOR = 0.72;
const HEAVY_BUS_FACTOR = 0.85;
const GREEN_MAX_S = 15;
const GREEN_ADDRESSABLE = 0.6;

export function runScenario(s: Scenario): {
  scenarioKg: number;
  deltaKg: number;
  deltaPct: number;
  greenSavingKg: number;
} {
  let afterEV = 0;
  for (const k of VEHICLE_CLASSES) {
    const base = baselinePerClass[k];
    const ev = clamp01(s.evShare[k] ?? 0);
    let v = base * (1 - ev);
    if (s.heavyRestriction && k === "truck") v *= HEAVY_TRUCK_FACTOR;
    if (s.heavyRestriction && k === "bus") v *= HEAVY_BUS_FACTOR;
    afterEV += v;
  }
  const idleLinked = baselineKg * idleShareFrac;
  const greenSavingKg =
    (clampNum(s.greenExtensionS ?? 0, 0, GREEN_MAX_S) / GREEN_MAX_S) *
    GREEN_ADDRESSABLE *
    idleLinked;
  const scenarioKg = Math.max(0, afterEV * (1 - greenSavingKg / Math.max(baselineKg, 1e-9)));
  const deltaKg = baselineKg - scenarioKg;
  const deltaPct = baselineKg > 0 ? (deltaKg / baselineKg) * 100 : 0;
  return {
    scenarioKg,
    deltaKg,
    deltaPct,
    greenSavingKg: Math.min(greenSavingKg, afterEV),
  };
}

export function windowLabel(): string {
  const sec = Math.round(windowSec);
  return `${sec} s observation window`;
}

/** Straight-line 24×7 extrapolation of the scenario delta + INR/tree equivalences. */
export function annualized(deltaKg: number): {
  tonnesPerYear: number;
  inrPerYear: number;
  treeYears: number;
} {
  const perYearKg = deltaKg * ((365 * 24 * 3600) / Math.max(windowSec, 1));
  return {
    tonnesPerYear: perYearKg / 1000,
    inrPerYear:
      (perYearKg / EQUIVALENCE_FACTORS.kgCo2PerLiterFuel) *
      EQUIVALENCE_FACTORS.fuelPriceInrPerL,
    treeYears: perYearKg / EQUIVALENCE_FACTORS.kgCo2PerTreeYear,
  };
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}
function clampNum(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
