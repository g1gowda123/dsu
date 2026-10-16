export type VehicleClass = 'car' | 'motorcycle' | 'auto_rickshaw' | 'bus' | 'truck';

export type KinematicState = 'IDLE' | 'ACCEL' | 'CRUISE' | 'DECEL';

export interface VehicleClassConfig {
  name: string;
  label: string;
  idle_g_per_min: number;
  cruise_g_per_km: number;
  accel_multiplier: number;
  mean_length_m: number;
  fuel_consumption_l_per_km: number;
  source: string;
  year: number | null;
  color: string;
}

export interface BoundingBox {
  id: string;
  classType: VehicleClass;
  state: KinematicState;
  speedKmh: number;
  co2Rate_gs: number;
  x: number; // percentage in frame (0 - 100)
  y: number; // percentage in frame (0 - 100)
  width: number; // percentage
  height: number; // percentage
  confidence: number;
  lane: 'N' | 'S' | 'E' | 'W';
  idleTimeSec: number;
}

export interface TelemetryPoint {
  timestampSec: number;
  emissionRate_gs: number;
  idleSpikeThreshold_gs: number;
  cumulativeCO2_kg: number;
  idleSharePct: number;
  trackedCount: number;
  byClassEmission: {
    car: number;
    motorcycle: number;
    auto_rickshaw: number;
    bus: number;
    truck: number;
  };
  byStateCount: {
    IDLE: number;
    ACCEL: number;
    CRUISE: number;
    DECEL: number;
  };
}

export interface ChokeZone {
  zoneId: string; // e.g., "Z_0_0" to "Z_3_3"
  row: number;
  col: number;
  label: string;
  lane: 'N' | 'S' | 'E' | 'W';
  idleVehicleMins: number;
  intensity: 'low' | 'moderate' | 'high' | 'critical';
  vehicleCount: number;
  dominantClass: VehicleClass;
  heavyVehicleCount: number;
}

export interface MunicipalDirective {
  id: string;
  timestamp: string;
  intersectionId: string;
  title: string;
  actionType: 'extend_green' | 'green_wave_priority' | 'heavy_vehicle_restriction' | 'no_action';
  lane: 'N' | 'S' | 'E' | 'W' | 'All';
  seconds: number;
  targetClass: VehicleClass | 'all_heavy' | null;
  estimatedCo2Saved_g: number;
  confidence: number;
  rationale: string;
  mode: 'llm' | 'rules_fallback';
  status: 'pending' | 'approved' | 'rejected' | 'dispatched';
  urgency: 'high' | 'medium' | 'routine';
}

export interface SimulationParams {
  evPenetration: {
    car: number; // 0 - 100
    motorcycle: number;
    auto_rickshaw: number;
    bus: number;
    truck: number;
  };
  adaptiveGreenExtensionSec: number; // 0 - 15
  heavyVehiclePeakRestriction: boolean;
  fuelPriceInr: number;
}

export interface SimulationResults {
  baselineCo2_kg: number;
  scenarioCo2_kg: number;
  abatementPct: number;
  savingsCo2_kg: number;
  annualizedInrSavings: number;
  equivalentTreesPlanted: number;
  breakdownByClass: {
    classType: VehicleClass;
    baseline: number;
    scenario: number;
    deltaPct: number;
  }[];
}

export interface JunctionMetadata {
  id: string;
  name: string;
  corridor: string;
  cctvStreamId: string;
  edgeFps: number;
  uplinkKbMin: number;
  totalLanes: number;
  status: 'Online' | 'Degraded' | 'Offline';
}
