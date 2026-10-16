import directivesMock from "@/data/directives_mock.json";
import series from "@/data/telemetry_series.json";
import eventsJson from "@/data/events.json";
import perceptionStats from "@/data/perception_stats.json";
import telemetryMeta from "@/data/telemetry_meta.json";
import framesJson from "@/data/telemetry_frames.json";

export type Lane = "N" | "S" | "E" | "W";
export type VehicleClass =
  | "car"
  | "motorcycle"
  | "auto_rickshaw"
  | "bus"
  | "truck";
export type Action =
  | "extend_green"
  | "green_wave_priority"
  | "heavy_vehicle_restriction"
  | "no_action";

export interface DirectiveAction {
  type: Action;
  lane: Lane | null;
  seconds: number | null;
  target_class: VehicleClass | null;
}

export interface Directive {
  directive_id: string;
  timestamp: string;
  intersection_id: string;
  actions: DirectiveAction[];
  estimated_co2_saved_g: number | null;
  confidence: number | null;
  rationale: string | null;
  mode: "llm" | "rules_fallback" | null;
}

export interface TelemetryPoint {
  timestampSec: number;
  emissionRate_gs: number;
  idleSpikeThreshold_gs: number;
  cumulativeCO2_kg: number;
  idleSharePct: number;
  trackedCount: number;
  byClassEmission: Record<VehicleClass, number>;
  byStateCount: Record<KinematicState, number>;
}

export type KinematicState = "CRUISE" | "ACCEL" | "IDLE" | "DECEL";

export interface TrackedVehicle {
  id: string;
  classType: VehicleClass;
  state: KinematicState;
  speedKmh: number;
  co2Rate_gs: number;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  lane: Lane | null;
  idleTimeSec: number;
}

export interface TrackedEvent {
  ts: number;
  event: string;
  track_id: number;
  cls: string;
  zone: string;
  value: number | null;
}

export const STATE_COLORS: Record<KinematicState, string> = {
  CRUISE: "#22c55e",
  ACCEL: "#f59e0b",
  IDLE: "#ef4444",
  DECEL: "#3b82f6",
};

export const VEHICLE_CLASSES: VehicleClass[] = [
  "car",
  "motorcycle",
  "auto_rickshaw",
  "bus",
  "truck",
];

/* Equivalence assumptions (documented in methodology drawer) */
export const EQUIVALENCE_FACTORS = {
  fuelPriceInrPerL: 100, // config/emission_factors.yaml — currency INR, config-driven
  kgCo2PerLiterFuel: 2.3, // ≈ petrol, EPA-emission-factor equivalence
  kgCo2PerTreeYear: 20, // urban tree sequestration ≈ 20 kg CO₂/yr
};

const seriesData = series as unknown as {
  points: TelemetryPoint[];
  vehiclesByTime: Record<string, TrackedVehicle[]>;
  metadata: {
    durationSec: number;
    intervalSec: number;
    totalTracks: number;
    totalPoints: number;
  };
};

const rawDirectives = (directivesMock as unknown as Directive[]).filter(
  (d): d is Directive => !!d && typeof d === "object" && "timestamp" in d,
);

const events = eventsJson as unknown as TrackedEvent[];

const points = seriesData.points;
const intervalSec = seriesData.metadata.intervalSec;
const spanSec = points.length > 0 ? points[points.length - 1].timestampSec : 0;

/**
 * Live-feed replay model: the recorded session plays back over `spanSec`.
 * Directives are re-issued at even intervals across the window so the feed
 * streams in sync with playback (documented in the methodology drawer).
 */
export const directives: Directive[] = [...rawDirectives].reverse();
export const replayT = (d: Directive): number => {
  const idx = rawDirectives.indexOf(rawDirectives.find((r) => r.directive_id === d.directive_id) ?? rawDirectives[0]);
  return ((idx + 1) / (rawDirectives.length + 1)) * spanSec;
};

/* Prefix aggregates for as-of-time stats */
const cumulativeUnique: number[] = (() => {
  const seen = new Set<string>();
  const out: number[] = [];
  for (const key of Object.keys(seriesData.vehiclesByTime).sort((a, b) => Number(a) - Number(b))) {
    for (const v of seriesData.vehiclesByTime[key] ?? []) seen.add(v.id);
    out.push(seen.size);
  }
  return out;
})();

function lerpAt(t: number, pick: (p: TelemetryPoint) => number): number {
  if (points.length === 0) return 0;
  const tt = Math.max(0, Math.min(t, spanSec));
  let i = 0;
  while (i < points.length - 1 && points[i + 1].timestampSec <= tt) i += 1;
  if (i >= points.length - 1) return pick(points[points.length - 1]);
  const a = points[i];
  const b = points[i + 1];
  if (tt <= a.timestampSec) return pick(a);
  const f = (tt - a.timestampSec) / (b.timestampSec - a.timestampSec);
  return pick(a) * (1 - f) + pick(b) * f;
}

export interface SessionStats {
  cumulativeCO2Kg: number;
  avoidedCO2G: number;
  vehiclesSeen: number;
  idleSharePct: number | null;
  stopEvents: number;
  topChokeZone: { zone: string; counts: number } | null;
  directivesIssued: number;
}

export function sessionStatsAt(t: number): SessionStats {
  const idx = Math.min(
    points.length - 1,
    Math.max(0, Math.floor(t / intervalSec)),
  );
  const cumulativeCO2Kg = lerpAt(t, (p) => p.cumulativeCO2_kg);

  let avoided = 0;
  let issued = 0;
  for (const d of rawDirectives) {
    if (replayT(d) <= t) {
      avoided += d.estimated_co2_saved_g ?? 0;
      issued += 1;
    }
  }

  const seen = cumulativeUnique[Math.min(cumulativeUnique.length - 1, idx)] ?? 0;

  const counted = events.filter((e) => e.event === "vehicle_counted" && e.ts <= t);
  const byZone = new Map<string, number>();
  for (const e of counted) {
    if (e.zone) byZone.set(e.zone, (byZone.get(e.zone) ?? 0) + 1);
  }
  let top: { zone: string; counts: number } | null = null;
  for (const [zone, counts] of byZone) {
    if (!top || counts > top.counts) top = { zone, counts };
  }

  return {
    cumulativeCO2Kg,
    avoidedCO2G: rawDirectives.length > 0 ? avoided : 0,
    vehiclesSeen: seen,
    idleSharePct: points.length > 0 ? lerpAt(t, (p) => p.idleSharePct) : null,
    stopEvents: events.filter((e) => e.event === "stop_started" && e.ts <= t).length,
    topChokeZone: top,
    directivesIssued: issued,
  };
}

const sessionEnd = sessionStatsAt(spanSec);
const heatEnd = (() => {
  const grid = Array.from({ length: 4 }, (_, r) =>
    Array.from({ length: 4 }, (_, c) => ({
      zone: `z_r${r}_c${c}`,
      counts: 0,
      byClass: {} as Partial<Record<VehicleClass, number>>,
      row: r,
      col: c,
    })),
  );
  for (const e of events) {
    if (e.event !== "vehicle_counted") continue;
    const m = /^z_r(\d)_c(\d)$/.exec(e.zone ?? "");
    if (!m) continue;
    const r = Number(m[1]);
    const c = Number(m[2]);
    if (r >= 4 || c >= 4) continue;
    grid[r][c].counts += 1;
    const cls = e.cls as VehicleClass;
    grid[r][c].byClass[cls] = (grid[r][c].byClass[cls] ?? 0) + 1;
  }
  return grid;
})();

export function heatmapAt(t: number) {
  const grid = heatEnd.map((row) =>
    row.map((cell) => ({ ...cell, byClass: { ...cell.byClass }, counts: 0 })),
  );
  for (const e of events) {
    if (e.event !== "vehicle_counted" || e.ts > t) continue;
    const m = /^z_r(\d)_c(\d)$/.exec(e.zone ?? "");
    if (!m) continue;
    const r = Number(m[1]);
    const c = Number(m[2]);
    if (r >= 4 || c >= 4) continue;
    grid[r][c].counts += 1;
    const cls = e.cls as VehicleClass;
    grid[r][c].byClass[cls] = (grid[r][c].byClass[cls] ?? 0) + 1;
  }
  const maxCounts = Math.max(1, ...grid.flat().map((c) => c.counts));
  return { grid, maxCounts };
}

const perClassEmission_gs: Record<VehicleClass, number | null> = {
  car: null,
  motorcycle: null,
  auto_rickshaw: null,
  bus: null,
  truck: null,
};
for (const p of points) {
  for (const k of VEHICLE_CLASSES) {
    perClassEmission_gs[k] =
      (perClassEmission_gs[k] ?? 0) + (p.byClassEmission?.[k] ?? 0);
  }
}
for (const k of VEHICLE_CLASSES) {
  perClassEmission_gs[k] =
    points.length > 0
      ? (perClassEmission_gs[k] as number) / points.length
      : null;
}

const fleetShare: Record<VehicleClass, number | null> = (() => {
  const hist = perceptionStats?.class_histogram ?? null;
  const total = hist
    ? Object.values(hist as Record<string, number>).reduce(
        (s, v) => s + (v ?? 0),
        0,
      )
    : 0;
  const out = {} as Record<VehicleClass, number | null>;
  for (const k of VEHICLE_CLASSES) {
    out[k] = hist && total > 0 ? (((hist[k] as number) ?? 0) / total) * 100 : null;
  }
  return out;
})();

export const data = {
  directives,
  replayT,
  telemetry: {
    points,
    vehiclesByTime: seriesData.vehiclesByTime,
    intervalSec,
    durationSec: seriesData.metadata.durationSec,
    spanSec,
  },
  perceptionStats,
  telemetryMeta,
  sessionEnd,
  summary: {
    junctionId: rawDirectives[0]?.intersection_id ?? null,
    cumulativeCO2Kg: sessionEnd.cumulativeCO2Kg,
    avoidedCO2G: sessionEnd.avoidedCO2G,
    vehiclesTracked: perceptionStats?.n_unique_tracks ?? null,
    idleSharePct: sessionEnd.idleSharePct,
    stopEvents: sessionEnd.stopEvents,
    topChokeZone: sessionEnd.topChokeZone,
  },
  factors: {
    perClassEmission_gs,
    fleetShare,
  },
};

export type DashboardData = typeof data;

/* ---- Per-frame ground overlay (15 Hz model cadence, display-interpolated) ---- */

export type OverlayTuple = [[number, number, number, number, number, number, number, string, number]];
export interface OverlayFrame {
  t: number;
  v: Array<[number, number, number, number, number, number, number, number, number, string]>;
}

const framesData = framesJson as unknown as {
  fps: number;
  minT: number;
  maxT: number;
  states: KinematicState[];
  classes: VehicleClass[];
  frames: OverlayFrame[];
};

export const overlay = {
  frames: framesData.frames,
  fps: framesData.fps,
  minT: framesData.minT,
  maxT: framesData.maxT,
  states: framesData.states,
  classes: framesData.classes,
};

/** Rightmost frame ≤ t plus the following frame + blend factor, for 60 fps interpolation. */
export function overlayAt(t: number): {
  a: OverlayFrame;
  b: OverlayFrame | null;
  f: number;
} {
  const frames = overlay.frames;
  if (frames.length === 0) return { a: { t, v: [] }, b: null, f: 0 };
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  const a = frames[lo];
  const b = lo < frames.length - 1 ? frames[lo + 1] : null;
  const f =
    b && b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
  return { a, b, f };
}

export function fmtNum(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

export function fmtClock(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(11, 19) + "Z";
}
