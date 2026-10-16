import {
  JunctionMetadata,
  VehicleClassConfig,
  ChokeZone,
  MunicipalDirective,
  TelemetryPoint,
  BoundingBox,
  SimulationParams,
} from '@/types/dashboard';

export const JUNCTIONS: JunctionMetadata[] = [
  {
    id: 'J04',
    name: 'Junction 04 - MG Road / Indiranagar',
    corridor: 'Corridor 04 (MG Road Arterial)',
    cctvStreamId: 'CAM-04-NORTH-FEED',
    edgeFps: 28.5,
    uplinkKbMin: 30.9,
    totalLanes: 6,
    status: 'Online',
  },
  {
    id: 'J01',
    name: 'Junction 01 - Silk Board Flyover / Hosur Rd',
    corridor: 'Corridor 01 (Hosur Highway)',
    cctvStreamId: 'CAM-01-SOUTH-FEED',
    edgeFps: 27.8,
    uplinkKbMin: 32.1,
    totalLanes: 8,
    status: 'Online',
  },
  {
    id: 'J07',
    name: 'Junction 07 - Hebbal Junction / Outer Ring Rd',
    corridor: 'Corridor 07 (Airport Expressway)',
    cctvStreamId: 'CAM-07-EAST-FEED',
    edgeFps: 29.1,
    uplinkKbMin: 28.4,
    totalLanes: 6,
    status: 'Online',
  },
  {
    id: 'J12',
    name: 'Junction 12 - Koramangala 80ft Road / Sony World',
    corridor: 'Corridor 12 (South-East Ring)',
    cctvStreamId: 'CAM-12-WEST-FEED',
    edgeFps: 28.2,
    uplinkKbMin: 31.5,
    totalLanes: 4,
    status: 'Online',
  },
];

export const EMISSION_FACTORS: Record<string, VehicleClassConfig> = {
  car: {
    name: 'car',
    label: 'Passenger Car',
    idle_g_per_min: 22,
    cruise_g_per_km: 150,
    accel_multiplier: 1.6,
    mean_length_m: 4.5,
    fuel_consumption_l_per_km: 0.075,
    source: 'CPCB / ARAI Emission Factor Development for Indian Vehicles; EPA MOVES3 urban idle benchmark',
    year: 2020,
    color: '#38bdf8', // Light Blue
  },
  motorcycle: {
    name: 'motorcycle',
    label: 'Motorcycle / Scooter (2W)',
    idle_g_per_min: 8,
    cruise_g_per_km: 80,
    accel_multiplier: 1.4,
    mean_length_m: 2.0,
    fuel_consumption_l_per_km: 0.028,
    source: 'CPCB / ARAI Emission Factor Database for Two-Wheelers',
    year: 2020,
    color: '#a855f7', // Purple
  },
  auto_rickshaw: {
    name: 'auto_rickshaw',
    label: 'Auto-Rickshaw (3W CNG/Petrol)',
    idle_g_per_min: 12,
    cruise_g_per_km: 95,
    accel_multiplier: 1.4,
    mean_length_m: 3.0,
    fuel_consumption_l_per_km: 0.045,
    source: 'CPCB Urban Three-Wheeler In-Use Emission Factor Study & IDD fine-tuned weights',
    year: 2021,
    color: '#eab308', // Yellow
  },
  bus: {
    name: 'bus',
    label: 'Transit Bus (BMTC Diesel)',
    idle_g_per_min: 45,
    cruise_g_per_km: 1000,
    accel_multiplier: 1.8,
    mean_length_m: 12.0,
    fuel_consumption_l_per_km: 0.38,
    source: 'CPCB / ARAI Urban Heavy Duty Diesel Transit Bus Emission Factors',
    year: 2020,
    color: '#f97316', // Orange
  },
  truck: {
    name: 'truck',
    label: 'Goods Transport Truck',
    idle_g_per_min: 55,
    cruise_g_per_km: 900,
    accel_multiplier: 2.0,
    mean_length_m: 10.0,
    fuel_consumption_l_per_km: 0.34,
    source: 'CPCB / ARAI Goods Transport Fleet Emission Database',
    year: 2020,
    color: '#ef4444', // Red
  },
};

// Generate realistic 120-second telemetry series
export function generateTelemetryData(): TelemetryPoint[] {
  const points: TelemetryPoint[] = [];
  let cumulative = 0;

  for (let sec = 0; sec <= 120; sec += 2) {
    // Congestion cycle: low at 0-20s, red light queue builds 25-65s, green discharge 70-95s, steady 100-120s
    let baseEmission = 18;
    let idleShare = 32;

    if (sec >= 24 && sec <= 68) {
      // Red light blockage on North-South: severe idle spike
      const progress = (sec - 24) / 44;
      const wave = Math.sin(progress * Math.PI);
      baseEmission = 24 + wave * 25 + (Math.sin(sec) * 3);
      idleShare = 48 + wave * 24;
    } else if (sec > 68 && sec <= 90) {
      // Green light acceleration wave
      const progress = (sec - 68) / 22;
      baseEmission = 32 - progress * 14 + (Math.cos(sec) * 2);
      idleShare = 60 - progress * 35;
    } else {
      // Normal flow
      baseEmission = 17 + Math.sin(sec * 0.2) * 5;
      idleShare = 30 + Math.cos(sec * 0.3) * 6;
    }

    const emissionRate = Math.max(12, Math.round(baseEmission * 10) / 10);
    cumulative += (emissionRate * 2) / 1000; // in kg

    const carRate = emissionRate * 0.32;
    const bikeRate = emissionRate * 0.16;
    const autoRate = emissionRate * 0.14;
    const busRate = emissionRate * 0.23;
    const truckRate = emissionRate * 0.15;

    // Kinematic distribution based on idle share
    const totalVehicles = 412;
    const idleCount = Math.round((idleShare / 100) * totalVehicles);
    const remaining = totalVehicles - idleCount;
    const accelCount = Math.round(remaining * (sec >= 68 && sec <= 90 ? 0.55 : 0.25));
    const decelCount = Math.round(remaining * (sec >= 20 && sec <= 35 ? 0.45 : 0.25));
    const cruiseCount = Math.max(0, remaining - accelCount - decelCount);

    points.push({
      timestampSec: sec,
      emissionRate_gs: emissionRate,
      idleSpikeThreshold_gs: 38.0, // Fixed threshold
      cumulativeCO2_kg: Math.round(cumulative * 100) / 100,
      idleSharePct: Math.round(idleShare * 10) / 10,
      trackedCount: totalVehicles,
      byClassEmission: {
        car: Math.round(carRate * 10) / 10,
        motorcycle: Math.round(bikeRate * 10) / 10,
        auto_rickshaw: Math.round(autoRate * 10) / 10,
        bus: Math.round(busRate * 10) / 10,
        truck: Math.round(truckRate * 10) / 10,
      },
      byStateCount: {
        IDLE: idleCount,
        ACCEL: accelCount,
        CRUISE: cruiseCount,
        DECEL: decelCount,
      },
    });
  }

  return points;
}

// 4x4 Spatial Choke-Point Matrix
export const CHOKE_MATRIX: ChokeZone[] = [
  // Row 0 (North Entrance)
  { zoneId: 'Z_0_0', row: 0, col: 0, label: 'N-Left Slip', lane: 'N', idleVehicleMins: 0.4, intensity: 'low', vehicleCount: 14, dominantClass: 'motorcycle', heavyVehicleCount: 0 },
  { zoneId: 'Z_0_1', row: 0, col: 1, label: 'N-Thru 1', lane: 'N', idleVehicleMins: 1.7, intensity: 'high', vehicleCount: 38, dominantClass: 'bus', heavyVehicleCount: 6 },
  { zoneId: 'Z_0_2', row: 0, col: 2, label: 'N-Thru 2', lane: 'N', idleVehicleMins: 1.9, intensity: 'high', vehicleCount: 42, dominantClass: 'truck', heavyVehicleCount: 8 },
  { zoneId: 'Z_0_3', row: 0, col: 3, label: 'N-Right Turn', lane: 'N', idleVehicleMins: 0.9, intensity: 'moderate', vehicleCount: 18, dominantClass: 'car', heavyVehicleCount: 1 },

  // Row 1 (Intersection Core - North Approach)
  { zoneId: 'Z_1_0', row: 1, col: 0, label: 'W-Exit Slip', lane: 'W', idleVehicleMins: 0.3, intensity: 'low', vehicleCount: 11, dominantClass: 'auto_rickshaw', heavyVehicleCount: 0 },
  { zoneId: 'Z_1_1', row: 1, col: 1, label: 'Central Box NW', lane: 'N', idleVehicleMins: 1.3, intensity: 'moderate', vehicleCount: 29, dominantClass: 'car', heavyVehicleCount: 2 },
  { zoneId: 'Z_1_2', row: 1, col: 2, label: 'North Stopline (CRITICAL)', lane: 'N', idleVehicleMins: 2.4, intensity: 'critical', vehicleCount: 56, dominantClass: 'bus', heavyVehicleCount: 14 },
  { zoneId: 'Z_1_3', row: 1, col: 3, label: 'E-Entry Merge', lane: 'E', idleVehicleMins: 1.1, intensity: 'moderate', vehicleCount: 24, dominantClass: 'motorcycle', heavyVehicleCount: 1 },

  // Row 2 (Intersection Core - South Approach)
  { zoneId: 'Z_2_0', row: 2, col: 0, label: 'W-Entry Merge', lane: 'W', idleVehicleMins: 0.8, intensity: 'moderate', vehicleCount: 19, dominantClass: 'car', heavyVehicleCount: 1 },
  { zoneId: 'Z_2_1', row: 2, col: 1, label: 'South Stopline', lane: 'S', idleVehicleMins: 1.8, intensity: 'high', vehicleCount: 44, dominantClass: 'truck', heavyVehicleCount: 9 },
  { zoneId: 'Z_2_2', row: 2, col: 2, label: 'Central Box SE', lane: 'S', idleVehicleMins: 1.2, intensity: 'moderate', vehicleCount: 27, dominantClass: 'auto_rickshaw', heavyVehicleCount: 2 },
  { zoneId: 'Z_2_3', row: 2, col: 3, label: 'E-Exit Slip', lane: 'E', idleVehicleMins: 0.2, intensity: 'low', vehicleCount: 9, dominantClass: 'motorcycle', heavyVehicleCount: 0 },

  // Row 3 (South Discharge)
  { zoneId: 'Z_3_0', row: 3, col: 0, label: 'S-Right Turn', lane: 'S', idleVehicleMins: 0.6, intensity: 'low', vehicleCount: 15, dominantClass: 'car', heavyVehicleCount: 1 },
  { zoneId: 'Z_3_1', row: 3, col: 1, label: 'S-Thru 1', lane: 'S', idleVehicleMins: 1.4, intensity: 'moderate', vehicleCount: 32, dominantClass: 'car', heavyVehicleCount: 3 },
  { zoneId: 'Z_3_2', row: 3, col: 2, label: 'S-Thru 2', lane: 'S', idleVehicleMins: 1.1, intensity: 'moderate', vehicleCount: 26, dominantClass: 'motorcycle', heavyVehicleCount: 1 },
  { zoneId: 'Z_3_3', row: 3, col: 3, label: 'S-Left Slip', lane: 'S', idleVehicleMins: 0.3, intensity: 'low', vehicleCount: 12, dominantClass: 'auto_rickshaw', heavyVehicleCount: 0 },
];

// Initial Municipal Directives conforming to schema in goals.md & user contract
export const INITIAL_DIRECTIVES: MunicipalDirective[] = [
  {
    id: 'DIR-2026-1049',
    timestamp: '2026-10-16T11:15:00Z',
    intersection_id: 'junction_01',
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
    timestamp: '2026-10-16T11:13:30Z',
    intersection_id: 'junction_04',
    actions: [
      { type: 'green_wave_priority', lane: 'N', seconds: 10, target_class: 'bus' },
    ],
    estimated_co2_saved_g: 485.2,
    confidence: 0.95,
    rationale:
      'Downstream platoons approaching from MG Road at 38 km/h. Signal phase offset adjusted +10s to prevent stop-and-go shockwaves across J04 and J05.',
    mode: 'llm',
    status: 'pending',
  },
  {
    id: 'DIR-2026-1047',
    timestamp: '2026-10-16T11:10:00Z',
    intersection_id: 'junction_01',
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
    timestamp: '2026-10-16T11:05:00Z',
    intersection_id: 'junction_04',
    actions: [
      { type: 'extend_green', lane: 'W', seconds: 5, target_class: 'auto_rickshaw' },
    ],
    estimated_co2_saved_g: 142.0,
    confidence: 0.84,
    rationale:
      'East-West minor approach queue cleared early. Truncating phase by 5s returns green cycle to saturated North arterial corridor.',
    mode: 'rules_fallback',
    status: 'pending',
  },
];

// Helper to generate simulated vehicles on screen for any given timestamp
export function getVehiclesAtTime(timeSec: number): BoundingBox[] {
  // 14 representative vehicles moving or idling across the intersection
  const isRedPhase = timeSec >= 24 && timeSec <= 68;
  const isDischargePhase = timeSec > 68 && timeSec <= 90;

  return [
    {
      id: 'TRK-104',
      classType: 'bus',
      state: isRedPhase ? 'IDLE' : isDischargePhase ? 'ACCEL' : 'CRUISE',
      speedKmh: isRedPhase ? 0 : isDischargePhase ? 18 : 34,
      co2Rate_gs: isRedPhase ? 0.75 : isDischargePhase ? 1.62 : 0.95,
      x: 48,
      y: isRedPhase ? 38 : Math.min(85, 38 + ((timeSec - 68) * 2.2)),
      width: 14,
      height: 18,
      confidence: 0.96,
      lane: 'N',
      idleTimeSec: isRedPhase ? timeSec - 24 : 0,
    },
    {
      id: 'TRK-105',
      classType: 'truck',
      state: isRedPhase ? 'IDLE' : isDischargePhase ? 'ACCEL' : 'CRUISE',
      speedKmh: isRedPhase ? 0 : isDischargePhase ? 14 : 28,
      co2Rate_gs: isRedPhase ? 0.92 : isDischargePhase ? 2.10 : 1.15,
      x: 62,
      y: isRedPhase ? 26 : Math.min(80, 26 + ((timeSec - 68) * 1.8)),
      width: 13,
      height: 16,
      confidence: 0.93,
      lane: 'N',
      idleTimeSec: isRedPhase ? timeSec - 22 : 0,
    },
    {
      id: 'CAR-202',
      classType: 'car',
      state: isRedPhase ? 'IDLE' : isDischargePhase ? 'ACCEL' : 'CRUISE',
      speedKmh: isRedPhase ? 0 : isDischargePhase ? 26 : 42,
      co2Rate_gs: isRedPhase ? 0.36 : isDischargePhase ? 0.58 : 0.38,
      x: 38,
      y: isRedPhase ? 46 : Math.min(92, 46 + ((timeSec - 68) * 3.0)),
      width: 9,
      height: 10,
      confidence: 0.98,
      lane: 'N',
      idleTimeSec: isRedPhase ? timeSec - 25 : 0,
    },
    {
      id: 'AUT-301',
      classType: 'auto_rickshaw',
      state: isRedPhase ? 'IDLE' : 'ACCEL',
      speedKmh: isRedPhase ? 0 : 22,
      co2Rate_gs: isRedPhase ? 0.20 : 0.38,
      x: 32,
      y: isRedPhase ? 52 : Math.min(90, 52 + ((timeSec - 68) * 2.5)),
      width: 7,
      height: 8,
      confidence: 0.91,
      lane: 'N',
      idleTimeSec: isRedPhase ? timeSec - 26 : 0,
    },
    {
      id: 'MOT-412',
      classType: 'motorcycle',
      state: isRedPhase ? 'IDLE' : 'ACCEL',
      speedKmh: isRedPhase ? 0 : 32,
      co2Rate_gs: isRedPhase ? 0.13 : 0.22,
      x: 44,
      y: isRedPhase ? 54 : Math.min(95, 54 + ((timeSec - 68) * 3.6)),
      width: 5,
      height: 6,
      confidence: 0.97,
      lane: 'N',
      idleTimeSec: isRedPhase ? timeSec - 28 : 0,
    },
    {
      id: 'MOT-413',
      classType: 'motorcycle',
      state: isRedPhase ? 'IDLE' : 'ACCEL',
      speedKmh: isRedPhase ? 0 : 30,
      co2Rate_gs: isRedPhase ? 0.13 : 0.21,
      x: 52,
      y: isRedPhase ? 55 : Math.min(94, 55 + ((timeSec - 68) * 3.4)),
      width: 5,
      height: 6,
      confidence: 0.95,
      lane: 'N',
      idleTimeSec: isRedPhase ? timeSec - 27 : 0,
    },
    // East-West Cross Traffic (moving when N-S is red, stopping when N-S is green)
    {
      id: 'CAR-209',
      classType: 'car',
      state: isRedPhase ? 'CRUISE' : 'DECEL',
      speedKmh: isRedPhase ? 38 : 12,
      co2Rate_gs: isRedPhase ? 0.35 : 0.22,
      x: isRedPhase ? ((timeSec * 3.5) % 90) + 5 : 72,
      y: 65,
      width: 10,
      height: 9,
      confidence: 0.94,
      lane: 'E',
      idleTimeSec: 0,
    },
    {
      id: 'AUT-308',
      classType: 'auto_rickshaw',
      state: isRedPhase ? 'CRUISE' : 'IDLE',
      speedKmh: isRedPhase ? 28 : 0,
      co2Rate_gs: isRedPhase ? 0.25 : 0.20,
      x: isRedPhase ? ((timeSec * 2.8) % 85) + 8 : 78,
      y: 70,
      width: 7,
      height: 8,
      confidence: 0.89,
      lane: 'E',
      idleTimeSec: !isRedPhase ? 12 : 0,
    },
    {
      id: 'BUS-110',
      classType: 'bus',
      state: isRedPhase ? 'CRUISE' : 'DECEL',
      speedKmh: isRedPhase ? 32 : 8,
      co2Rate_gs: isRedPhase ? 1.05 : 0.55,
      x: isRedPhase ? ((timeSec * 2.2) % 80) + 10 : 82,
      y: 60,
      width: 15,
      height: 14,
      confidence: 0.97,
      lane: 'E',
      idleTimeSec: 0,
    },
    {
      id: 'CAR-215',
      classType: 'car',
      state: 'CRUISE',
      speedKmh: 44,
      co2Rate_gs: 0.39,
      x: 18,
      y: ((timeSec * 2.5) % 80) + 10,
      width: 8,
      height: 9,
      confidence: 0.95,
      lane: 'W',
      idleTimeSec: 0,
    },
    {
      id: 'MOT-440',
      classType: 'motorcycle',
      state: 'CRUISE',
      speedKmh: 46,
      co2Rate_gs: 0.15,
      x: 12,
      y: ((timeSec * 3.2) % 85) + 8,
      width: 4,
      height: 5,
      confidence: 0.92,
      lane: 'W',
      idleTimeSec: 0,
    },
    {
      id: 'TRK-120',
      classType: 'truck',
      state: isRedPhase ? 'IDLE' : 'CRUISE',
      speedKmh: isRedPhase ? 0 : 30,
      co2Rate_gs: isRedPhase ? 0.92 : 1.25,
      x: 58,
      y: isRedPhase ? 15 : Math.min(75, 15 + ((timeSec - 68) * 1.5)),
      width: 12,
      height: 15,
      confidence: 0.94,
      lane: 'N',
      idleTimeSec: isRedPhase ? timeSec - 20 : 0,
    },
  ];
}

// Compute what-if scenario based on simulation inputs
export function computeSimulation(
  params: SimulationParams,
  baselineCo2_kg = 24.8
): {
  baselineCo2_kg: number;
  scenarioCo2_kg: number;
  abatementPct: number;
  savingsCo2_kg: number;
  annualizedInrSavings: number;
  equivalentTreesPlanted: number;
  breakdownByClass: {
    classType: string;
    label: string;
    baseline: number;
    scenario: number;
    deltaPct: number;
    color: string;
  }[];
} {
  // Baseline share of carbon by class in current 2-min window (in kg)
  // car: 7.94 kg, motorcycle: 3.97 kg, auto: 3.47 kg, bus: 5.70 kg, truck: 3.72 kg -> Total 24.8 kg
  const classBaselines = {
    car: 7.94,
    motorcycle: 3.97,
    auto_rickshaw: 3.47,
    bus: 5.70,
    truck: 3.72,
  };

  // Signal timing bonus: adaptive green extension reduces idle stop events
  // 0s: 0% reduction, 15s: up to 18% reduction across all classes
  const signalTimingFactor = 1 - (params.adaptiveGreenExtensionSec / 15) * 0.18;

  // Heavy restriction toggle: reduces bus/truck stop idle by 28%
  const heavyRestrictionFactor = params.heavyVehiclePeakRestriction ? 0.72 : 1.0;

  let totalScenario = 0;

  const breakdown = Object.entries(classBaselines).map(([cls, baseline]) => {
    const config = EMISSION_FACTORS[cls];
    const evShare = (params.evPenetration as Record<string, number>)[cls] || 0;
    const evFactor = 1 - (evShare / 100);

    let specificFactor = signalTimingFactor * evFactor;
    if (cls === 'bus' || cls === 'truck') {
      specificFactor *= heavyRestrictionFactor;
    }

    const scenario = Math.round(baseline * specificFactor * 100) / 100;
    totalScenario += scenario;

    const deltaPct = Math.round(((scenario - baseline) / baseline) * 1000) / 10;

    return {
      classType: cls,
      label: config.label,
      baseline,
      scenario,
      deltaPct,
      color: config.color,
    };
  });

  totalScenario = Math.round(totalScenario * 100) / 100;
  const savingsKg = Math.round((baselineCo2_kg - totalScenario) * 100) / 100;
  const abatementPct = Math.round((savingsKg / baselineCo2_kg) * 1000) / 10;

  // Annualized calculations:
  // 2-min sample extrapolated to annual peak corridor hours (14 hours/day * 365 days = 5,110 hours = 153,300 2-min intervals)
  const annualMultiplier = (14 * 60) / 2 * 365;
  const annualSavedKg = savingsKg * annualMultiplier;
  
  // Fuel conversion: 1 litre diesel/petrol ≈ 2.68 kg CO2
  // Fuel savings (Litres) = annualSavedKg / 2.68
  const annualSavedLitres = annualSavedKg / 2.68;
  const annualizedInrSavings = Math.round(annualSavedLitres * params.fuelPriceInr);

  // Tree carbon sequestration equivalence: ~21.77 kg CO2 / tree / year (EPA / Indian Forestry standard)
  const equivalentTreesPlanted = Math.round(annualSavedKg / 21.77);

  return {
    baselineCo2_kg,
    scenarioCo2_kg: totalScenario,
    abatementPct,
    savingsCo2_kg: savingsKg,
    annualizedInrSavings,
    equivalentTreesPlanted,
    breakdownByClass: breakdown,
  };
}
