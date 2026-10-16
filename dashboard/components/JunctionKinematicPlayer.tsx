import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
  Maximize,
  Minimize,
  Volume2,
  VolumeX,
  Layers,
  AlertTriangle,
  Activity,
  Cpu,
  ShieldCheck,
  VideoOff,
  Video,
  Info,
  Car,
  Truck,
  Bus,
  Bike,
  Gauge,
  Clock,
  Sparkles,
} from 'lucide-react';

/* =========================================================================
   TYPE DEFINITIONS & CONSTANTS
   ========================================================================= */

export type KinematicState = 'IDLE' | 'ACCEL' | 'CRUISE' | 'DECEL';
export type VehicleClass = 'car' | 'motorcycle' | 'auto_rickshaw' | 'bus' | 'truck';

export interface VehicleTelemetry {
  trackId: number;
  cls: VehicleClass;
  // Bounding box in normalized percentage coordinates (0 - 100)
  x: number;
  y: number;
  w: number;
  h: number;
  speedKmh: number;
  state: KinematicState;
  approach: 'North' | 'South' | 'East' | 'West';
  headingDeg: number;
  co2RateGps: number;
}

export interface CongestionWindow {
  start: number; // in seconds
  end: number;   // in seconds
  label: string;
  severity: 'moderate' | 'heavy' | 'critical';
}

export interface KinematicBreakdown {
  idle: number;
  accel: number;
  cruise: number;
  decel: number;
  total: number;
  percentages: {
    idle: number;
    accel: number;
    cruise: number;
    decel: number;
  };
}

export interface JunctionKinematicPlayerProps {
  /** Video feed URL (e.g., CCTV stream or recorded clip). Falls back gracefully if unavailable. */
  videoSrc?: string;
  /** Telemetry duration in seconds (default: 60.0s) */
  duration?: number;
  /** Optional initial scrubber time in seconds */
  initialTime?: number;
  /** Callback fired whenever the scrubber / video playback updates */
  onTimeChange?: (currentTime: number) => void;
  /** Callback fired whenever the kinematic breakdown shifts */
  onBreakdownChange?: (breakdown: KinematicBreakdown) => void;
  /** Title badge for junction location */
  junctionName?: string;
  /** Custom extra CSS classes */
  className?: string;
  /** Force synthetic schematic mode without attempting video load */
  forceSchematic?: boolean;
}

// Strict requirement colors
export const STATE_COLORS: Record<KinematicState, { hex: string; bg: string; text: string; border: string; glow: string }> = {
  IDLE: {
    hex: '#ef4444',
    bg: 'bg-[#ef4444]',
    text: 'text-[#ef4444]',
    border: 'border-[#ef4444]',
    glow: 'rgba(239, 68, 68, 0.45)',
  },
  ACCEL: {
    hex: '#f59e0b',
    bg: 'bg-[#f59e0b]',
    text: 'text-[#f59e0b]',
    border: 'border-[#f59e0b]',
    glow: 'rgba(245, 158, 11, 0.45)',
  },
  CRUISE: {
    hex: '#10b981',
    bg: 'bg-[#10b981]',
    text: 'text-[#10b981]',
    border: 'border-[#10b981]',
    glow: 'rgba(16, 185, 129, 0.45)',
  },
  DECEL: {
    hex: '#3b82f6',
    bg: 'bg-[#3b82f6]',
    text: 'text-[#3b82f6]',
    border: 'border-[#3b82f6]',
    glow: 'rgba(59, 130, 246, 0.45)',
  },
};

// Defined congestion choke periods
export const DEFAULT_CONGESTION_WINDOWS: CongestionWindow[] = [
  {
    start: 13.5,
    end: 25.8,
    label: 'Phase 1 N-S Signal Red // Queue Saturation',
    severity: 'heavy',
  },
  {
    start: 37.0,
    end: 49.2,
    label: 'Phase 2 Transit Bus Choke // Secondary Idle Buildup',
    severity: 'critical',
  },
];

/* =========================================================================
   MOCK TELEMETRY ENGINE & HOOK
   ========================================================================= */

interface SyntheticVehicleSeed {
  id: number;
  cls: VehicleClass;
  approach: 'North' | 'South' | 'East' | 'West';
  tEnter: number;
  tStopStart?: number;
  tStopEnd?: number;
  maxSpeed: number;
  w: number;
  h: number;
  laneOffset: number;
}

/**
 * Generates deterministic, physically grounded synthetic vehicle tracks
 * simulating Delhi-style urban junction traffic behavior over 60 seconds.
 */
function generateDeterministicVehicles(totalVehicles = 34): SyntheticVehicleSeed[] {
  const seeds: SyntheticVehicleSeed[] = [];
  const classes: VehicleClass[] = [
    'motorcycle', 'motorcycle', 'motorcycle', 'motorcycle',
    'car', 'car', 'car',
    'auto_rickshaw', 'auto_rickshaw',
    'bus', 'truck'
  ];
  const approaches: Array<'North' | 'South' | 'East' | 'West'> = ['North', 'South', 'East', 'West'];

  for (let i = 0; i < totalVehicles; i++) {
    const cls = classes[i % classes.length];
    const approach = approaches[i % 4];
    const tEnter = Number(((i * 1.55) % 45).toFixed(1));
    const stops = i % 3 !== 0; // ~66% stop at red/choke
    const tStopStart = stops ? tEnter + 4 + (i % 5) * 1.2 : undefined;
    const tStopEnd = tStopStart ? tStopStart + 8 + (i % 4) * 3 : undefined;

    let w = 4.2;
    let h = 3.2;
    let maxSpeed = 38;

    if (cls === 'motorcycle') {
      w = 2.4;
      h = 1.8;
      maxSpeed = 44;
    } else if (cls === 'auto_rickshaw') {
      w = 3.4;
      h = 2.6;
      maxSpeed = 32;
    } else if (cls === 'bus') {
      w = 7.5;
      h = 5.2;
      maxSpeed = 28;
    } else if (cls === 'truck') {
      w = 6.8;
      h = 4.8;
      maxSpeed = 26;
    }

    seeds.push({
      id: 101 + i,
      cls,
      approach,
      tEnter,
      tStopStart,
      tStopEnd,
      maxSpeed,
      w,
      h,
      laneOffset: ((i % 5) - 2) * 2.2,
    });
  }

  return seeds;
}

/**
 * Custom hook producing live synchronous kinematic telemetry at any timestamp t.
 */
export function useJunctionTelemetry(duration = 60.0) {
  const seeds = useMemo(() => generateDeterministicVehicles(36), []);

  const getVehiclesAtTime = useCallback((t: number): VehicleTelemetry[] => {
    const active: VehicleTelemetry[] = [];

    seeds.forEach((seed) => {
      const elapsed = t - seed.tEnter;
      if (elapsed < 0 || elapsed > 28) return; // vehicle active window

      let progress = elapsed / 28; // 0.0 to 1.0 along the corridor
      let speedKmh = seed.maxSpeed;
      let state: KinematicState = 'CRUISE';

      if (seed.tStopStart && seed.tStopEnd) {
        if (t >= seed.tStopStart && t <= seed.tStopEnd) {
          state = 'IDLE';
          speedKmh = 0.0;
          progress = 0.42; // Stopped at junction conflict line
        } else if (t < seed.tStopStart && seed.tStopStart - t <= 3.2) {
          state = 'DECEL';
          const decelRatio = (seed.tStopStart - t) / 3.2;
          speedKmh = Math.max(2, seed.maxSpeed * decelRatio);
          progress = 0.35 + (1 - decelRatio) * 0.07;
        } else if (t > seed.tStopEnd && t - seed.tStopEnd <= 4.0) {
          state = 'ACCEL';
          const accelRatio = (t - seed.tStopEnd) / 4.0;
          speedKmh = Math.min(seed.maxSpeed, 4 + seed.maxSpeed * accelRatio);
          progress = 0.42 + accelRatio * 0.18;
        } else if (t > seed.tStopEnd + 4.0) {
          state = 'CRUISE';
          speedKmh = seed.maxSpeed;
          progress = 0.60 + ((t - (seed.tStopEnd + 4.0)) / 12) * 0.40;
        }
      }

      // Map approach to 2D percentage coordinates
      let x = 50;
      let y = 50;
      let heading = 0;

      if (seed.approach === 'North') {
        x = 44 + seed.laneOffset;
        y = Math.min(96, Math.max(4, 4 + progress * 92));
        heading = 180;
      } else if (seed.approach === 'South') {
        x = 56 + seed.laneOffset;
        y = Math.max(4, Math.min(96, 96 - progress * 92));
        heading = 0;
      } else if (seed.approach === 'West') {
        x = Math.min(96, Math.max(4, 4 + progress * 92));
        y = 56 + seed.laneOffset;
        heading = 90;
      } else {
        x = Math.max(4, Math.min(96, 96 - progress * 92));
        y = 44 + seed.laneOffset;
        heading = 270;
      }

      // Approximate CO2 emissions based on BS-VI factors (g/s)
      let co2Rate = 0.35;
      if (state === 'IDLE') co2Rate = seed.cls === 'bus' || seed.cls === 'truck' ? 0.75 : 0.28;
      else if (state === 'ACCEL') co2Rate = seed.cls === 'bus' || seed.cls === 'truck' ? 3.4 : 1.45;
      else if (state === 'CRUISE') co2Rate = seed.cls === 'bus' || seed.cls === 'truck' ? 2.1 : 0.85;
      else if (state === 'DECEL') co2Rate = 0.42;

      active.push({
        trackId: seed.id,
        cls: seed.cls,
        x,
        y,
        w: seed.w,
        h: seed.h,
        speedKmh: Number(speedKmh.toFixed(1)),
        state,
        approach: seed.approach,
        headingDeg: heading,
        co2RateGps: Number(co2Rate.toFixed(2)),
      });
    });

    return active;
  }, [seeds]);

  return { getVehiclesAtTime, congestionWindows: DEFAULT_CONGESTION_WINDOWS };
}

/* =========================================================================
   FALLBACK 4-WAY INTERSECTION SCHEMATIC (SVG)
   ========================================================================= */

interface IntersectionSchematicProps {
  vehicles: VehicleTelemetry[];
  currentTime: number;
  congestionActive: boolean;
}

export const IntersectionSchematic: React.FC<IntersectionSchematicProps> = ({
  vehicles,
  currentTime,
  congestionActive,
}) => {
  return (
    <div className="relative w-full h-full bg-[#0a0f1d] overflow-hidden select-none flex items-center justify-center">
      <svg
        viewBox="0 0 800 800"
        className="w-full h-full max-h-[700px] object-contain transition-all duration-300"
      >
        <defs>
          {/* Subtle asphalt grid texture */}
          <pattern id="asphalt-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#162032" strokeWidth="0.75" />
          </pattern>

          {/* Conflict Zone Radial Gradient */}
          <radialGradient id="conflictGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={congestionActive ? '#ef4444' : '#38bdf8'} stopOpacity="0.22" />
            <stop offset="70%" stopColor={congestionActive ? '#ef4444' : '#38bdf8'} stopOpacity="0.05" />
            <stop offset="100%" stopColor="#0a0f1d" stopOpacity="0" />
          </radialGradient>

          {/* Vehicle Pulsing Filter */}
          <filter id="idleGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Ambient Grid Background */}
        <rect width="800" height="800" fill="#070b14" />
        <rect width="800" height="800" fill="url(#asphalt-grid)" opacity="0.6" />

        {/* ================= ROAD GEOMETRY ================= */}
        {/* Curbs / Corner Grass & Infrastructure */}
        <path d="M 0,0 L 290,0 L 290,290 L 0,290 Z" fill="#0d1527" stroke="#1e293b" strokeWidth="2" />
        <path d="M 510,0 L 800,0 L 800,290 L 510,290 Z" fill="#0d1527" stroke="#1e293b" strokeWidth="2" />
        <path d="M 0,510 L 290,510 L 290,800 L 0,800 Z" fill="#0d1527" stroke="#1e293b" strokeWidth="2" />
        <path d="M 510,510 L 800,510 L 800,800 L 510,800 Z" fill="#0d1527" stroke="#1e293b" strokeWidth="2" />

        {/* Road Surfaces */}
        {/* North-South corridor */}
        <rect x="290" y="0" width="220" height="800" fill="#111827" />
        {/* East-West corridor */}
        <rect x="0" y="290" width="800" height="220" fill="#111827" />

        {/* Conflict Zone Glow */}
        <rect x="290" y="290" width="220" height="220" fill="url(#conflictGlow)" />
        <rect
          x="292"
          y="292"
          width="216"
          height="216"
          fill="none"
          stroke={congestionActive ? '#ef4444' : '#38bdf8'}
          strokeWidth="1.5"
          strokeDasharray="8 6"
          opacity={congestionActive ? 0.9 : 0.4}
        />

        {/* Pedestrian Zebra Crossings */}
        {/* North Zebra */}
        {Array.from({ length: 9 }).map((_, i) => (
          <rect key={`zn-${i}`} x={306 + i * 22} y="260" width="14" height="24" fill="#334155" opacity="0.75" />
        ))}
        {/* South Zebra */}
        {Array.from({ length: 9 }).map((_, i) => (
          <rect key={`zs-${i}`} x={306 + i * 22} y="516" width="14" height="24" fill="#334155" opacity="0.75" />
        ))}
        {/* West Zebra */}
        {Array.from({ length: 9 }).map((_, i) => (
          <rect key={`zw-${i}`} x="260" y={306 + i * 22} width="24" height="14" fill="#334155" opacity="0.75" />
        ))}
        {/* East Zebra */}
        {Array.from({ length: 9 }).map((_, i) => (
          <rect key={`ze-${i}`} x="516" y={306 + i * 22} width="24" height="14" fill="#334155" opacity="0.75" />
        ))}

        {/* Stop Lines */}
        <line x1="290" y1="288" x2="510" y2="288" stroke="#cbd5e1" strokeWidth="3" opacity="0.8" />
        <line x1="290" y1="512" x2="510" y2="512" stroke="#cbd5e1" strokeWidth="3" opacity="0.8" />
        <line x1="288" y1="290" x2="288" y2="510" stroke="#cbd5e1" strokeWidth="3" opacity="0.8" />
        <line x1="512" y1="290" x2="512" y2="510" stroke="#cbd5e1" strokeWidth="3" opacity="0.8" />

        {/* Dashed Center Dividers */}
        <line x1="400" y1="0" x2="400" y2="260" stroke="#f59e0b" strokeWidth="2.5" strokeDasharray="14 12" />
        <line x1="400" y1="540" x2="400" y2="800" stroke="#f59e0b" strokeWidth="2.5" strokeDasharray="14 12" />
        <line x1="0" y1="400" x2="260" y2="400" stroke="#f59e0b" strokeWidth="2.5" strokeDasharray="14 12" />
        <line x1="540" y1="400" x2="800" y2="400" stroke="#f59e0b" strokeWidth="2.5" strokeDasharray="14 12" />

        {/* Junction Conflict Zone Center Marker */}
        <circle cx="400" cy="400" r="16" fill="none" stroke="#64748b" strokeWidth="1.5" strokeDasharray="4 4" />
        <circle cx="400" cy="400" r="4" fill={congestionActive ? '#ef4444' : '#38bdf8'} />

        {/* Directional Approach Indicators */}
        <g fill="#475569" fontSize="12" fontWeight="700" letterSpacing="2" textAnchor="middle">
          <text x="400" y="32">NORTHBOUND APPROACH</text>
          <text x="400" y="784">SOUTHBOUND APPROACH</text>
          <text x="50" y="405" transform="rotate(-90 50 405)">WESTBOUND</text>
          <text x="750" y="405" transform="rotate(90 750 405)">EASTBOUND</text>
        </g>

        {/* Live Traffic Phase Beacon in Corners */}
        <g transform="translate(265, 265)">
          <circle cx="0" cy="0" r="10" fill="#0f172a" stroke="#334155" strokeWidth="2" />
          <circle
            cx="0"
            cy="0"
            r="5"
            fill={congestionActive ? '#ef4444' : '#10b981'}
            className="animate-ping"
            opacity="0.8"
          />
          <circle cx="0" cy="0" r="5" fill={congestionActive ? '#ef4444' : '#10b981'} />
        </g>

        {/* ================= VEHICLE NODES (ANIMATED & PULSATING) ================= */}
        {vehicles.map((v) => {
          // Convert percentage coordinates (0-100) to SVG canvas coordinates (800x800)
          const cx = (v.x / 100) * 800;
          const cy = (v.y / 100) * 800;
          const isIdle = v.state === 'IDLE';
          const cfg = STATE_COLORS[v.state];

          const radius = v.cls === 'bus' || v.cls === 'truck' ? 14 : v.cls === 'car' ? 11 : 8;

          return (
            <g
              key={`veh-node-${v.trackId}`}
              className="transition-transform duration-100"
              transform={`translate(${cx}, ${cy})`}
            >
              {/* Pulsating Idle Aura */}
              {isIdle && (
                <>
                  <circle
                    cx="0"
                    cy="0"
                    r={radius + 14}
                    fill={cfg.hex}
                    opacity="0.25"
                    className="animate-ping"
                  />
                  <circle
                    cx="0"
                    cy="0"
                    r={radius + 8}
                    fill="none"
                    stroke={cfg.hex}
                    strokeWidth="1.5"
                    opacity="0.6"
                    className="animate-pulse"
                  />
                </>
              )}

              {/* Directional Velocity Vector for moving vehicles */}
              {!isIdle && (
                <line
                  x1="0"
                  y1="0"
                  x2={Math.sin((v.headingDeg * Math.PI) / 180) * 22}
                  y2={-Math.cos((v.headingDeg * Math.PI) / 180) * 22}
                  stroke={cfg.hex}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  opacity="0.85"
                />
              )}

              {/* Main Vehicle Body Node */}
              <circle
                cx="0"
                cy="0"
                r={radius}
                fill="#0f172a"
                stroke={cfg.hex}
                strokeWidth="2.5"
                filter={isIdle ? 'url(#idleGlow)' : undefined}
              />

              {/* Inner Core */}
              <circle cx="0" cy="0" r={radius * 0.45} fill={cfg.hex} />

              {/* Label Tag */}
              <g transform="translate(0, -18)">
                <rect
                  x="-32"
                  y="-10"
                  width="64"
                  height="16"
                  rx="4"
                  fill="#020617"
                  stroke={cfg.hex}
                  strokeWidth="1"
                  opacity="0.9"
                />
                <text
                  x="0"
                  y="2"
                  fill="#f8fafc"
                  fontSize="9"
                  fontFamily="monospace"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  {v.cls.substring(0, 3).toUpperCase()}-{v.trackId}
                </text>
              </g>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

/* =========================================================================
   MAIN COMPONENT: JunctionKinematicPlayer
   ========================================================================= */

export const JunctionKinematicPlayer: React.FC<JunctionKinematicPlayerProps> = ({
  videoSrc = 'data/videos/junction.mp4',
  duration = 60.0,
  initialTime = 0.0,
  onTimeChange,
  onBreakdownChange,
  junctionName = 'DELHI-ND-J04 // JUNCTION 01',
  className = '',
  forceSchematic = false,
}) => {
  // Scrubber & Playback state
  const [currentTime, setCurrentTime] = useState<number>(initialTime);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showOverlays, setShowOverlays] = useState<boolean>(true);
  const [videoError, setVideoError] = useState<boolean>(false);
  const [isVideoLoaded, setIsVideoLoaded] = useState<boolean>(false);
  const [manualFallbackToggle, setManualFallbackToggle] = useState<boolean>(false);
  const [scrubberHoverTime, setScrubberHoverTime] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const lastTickTimeRef = useRef<number | null>(null);

  // Hook for synthetic telemetry data
  const { getVehiclesAtTime, congestionWindows } = useJunctionTelemetry(duration);

  // Vehicles active at the current timestamp
  const activeVehicles = useMemo(() => {
    return getVehiclesAtTime(currentTime);
  }, [getVehiclesAtTime, currentTime]);

  // Breakdown counts and percentages
  const breakdown: KinematicBreakdown = useMemo(() => {
    let idle = 0;
    let accel = 0;
    let cruise = 0;
    let decel = 0;

    activeVehicles.forEach((v) => {
      if (v.state === 'IDLE') idle++;
      else if (v.state === 'ACCEL') accel++;
      else if (v.state === 'CRUISE') cruise++;
      else if (v.state === 'DECEL') decel++;
    });

    const total = Math.max(1, idle + accel + cruise + decel);

    return {
      idle,
      accel,
      cruise,
      decel,
      total: activeVehicles.length,
      percentages: {
        idle: Math.round((idle / total) * 100),
        accel: Math.round((accel / total) * 100),
        cruise: Math.round((cruise / total) * 100),
        decel: Math.round((decel / total) * 100),
      },
    };
  }, [activeVehicles]);

  // Notify parent of breakdown shifts
  useEffect(() => {
    onBreakdownChange?.(breakdown);
  }, [breakdown, onBreakdownChange]);

  // Notify parent of time change
  useEffect(() => {
    onTimeChange?.(currentTime);
  }, [currentTime, onTimeChange]);

  // Sync HTML5 video element with state currentTime
  useEffect(() => {
    if (videoRef.current && Math.abs(videoRef.current.currentTime - currentTime) > 0.25) {
      videoRef.current.currentTime = currentTime;
    }
  }, [currentTime]);

  // Synchronize playback speed
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  // Custom playback loop (drives synthetic clock and video synchronization)
  useEffect(() => {
    if (!isPlaying) {
      lastTickTimeRef.current = null;
      if (videoRef.current && !videoRef.current.paused) {
        videoRef.current.pause();
      }
      return;
    }

    if (videoRef.current && isVideoLoaded && !videoError && !manualFallbackToggle) {
      videoRef.current.play().catch(() => {
        // Autoplay policy or format error triggers fallback
        setVideoError(true);
      });
    }

    const tick = (now: number) => {
      if (lastTickTimeRef.current === null) {
        lastTickTimeRef.current = now;
      }
      const deltaSec = ((now - lastTickTimeRef.current) / 1000) * playbackSpeed;
      lastTickTimeRef.current = now;

      setCurrentTime((prev) => {
        const next = prev + deltaSec;
        if (next >= duration) {
          setIsPlaying(false);
          return duration;
        }
        return Number(next.toFixed(2));
      });

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [isPlaying, playbackSpeed, duration, isVideoLoaded, videoError, manualFallbackToggle]);

  // Handlers for controls
  const togglePlay = useCallback(() => {
    setIsPlaying((p) => {
      if (currentTime >= duration) {
        setCurrentTime(0);
      }
      return !p;
    });
  }, [currentTime, duration]);

  const stepFrame = useCallback((deltaSeconds: number) => {
    setIsPlaying(false);
    setCurrentTime((t) => {
      const next = Math.max(0, Math.min(duration, t + deltaSeconds));
      return Number(next.toFixed(2));
    });
  }, [duration]);

  const handleSeek = (newTime: number) => {
    const clamped = Math.max(0, Math.min(duration, newTime));
    setCurrentTime(Number(clamped.toFixed(2)));
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Keyboard accessibility
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        stepFrame(0.1);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        stepFrame(-0.1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, stepFrame]);

  // Check if current time falls within an active congestion choke window
  const activeCongestionWindow = useMemo(() => {
    return congestionWindows.find((w) => currentTime >= w.start && currentTime <= w.end);
  }, [congestionWindows, currentTime]);

  // Format seconds into MM:SS.S
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const tenths = Math.floor((seconds % 1) * 10);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${tenths}`;
  };

  // Determine whether to show the fallback SVG schematic
  const isFallbackActive = forceSchematic || videoError || manualFallbackToggle || !videoSrc;

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col w-full max-w-6xl mx-auto rounded-xl overflow-hidden bg-slate-950 border border-slate-800 shadow-2xl text-slate-100 font-sans ${className}`}
    >
      {/* =====================================================================
          TOP HEADER BAR: TELEMETRY STATUS & WATERMARK
          ===================================================================== */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2.5 bg-slate-900/90 border-b border-slate-800/80 backdrop-blur-md text-xs font-mono z-20">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isFallbackActive ? 'bg-amber-400' : 'bg-emerald-400'}`} />
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isFallbackActive ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            </span>
            <span className="font-bold tracking-wider text-slate-200">
              {junctionName}
            </span>
          </div>

          <span className="text-slate-600 hidden sm:inline">|</span>

          {/* Hard Requirement Status Watermark */}
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-950/80 border border-slate-800 text-[11px] text-slate-300">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-semibold text-emerald-400 tracking-wide">
              EDGE INFERENCE // NO VIDEO EGRESS // PII PURGED
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 mt-1 sm:mt-0">
          {/* Active Choke Warning Badge */}
          {activeCongestionWindow && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-red-950/80 border border-red-500/40 text-red-400 animate-pulse text-[11px]">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
              <span className="font-bold">HEAVY IDLE CONGESTION</span>
            </div>
          )}

          {/* Fallback / Video Source Switcher Toggle */}
          <button
            onClick={() => setManualFallbackToggle(!manualFallbackToggle)}
            title="Toggle between real CCTV video stream and 4-way synthetic schematic"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors border border-slate-700/60"
          >
            {isFallbackActive ? (
              <>
                <Video className="w-3.5 h-3.5 text-sky-400" />
                <span className="hidden sm:inline">CCTV View</span>
              </>
            ) : (
              <>
                <Cpu className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Schematic View</span>
              </>
            )}
          </button>

          {/* Overlay Box Visibility Toggle */}
          <button
            onClick={() => setShowOverlays(!showOverlays)}
            title={showOverlays ? 'Hide Bounding Boxes' : 'Show Bounding Boxes'}
            className={`p-1.5 rounded-md border transition-colors ${
              showOverlays
                ? 'bg-slate-800 border-slate-600 text-emerald-400'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* =====================================================================
          1. VIDEO / SCHEMATIC PRESENTATION AREA
          ===================================================================== */}
      <div className="relative w-full aspect-[16/9] bg-black overflow-hidden flex items-center justify-center group">
        {/* Requirement 1 Watermark: Overlay status watermark persistent across both modes */}
        <div className="absolute top-3 left-3 pointer-events-none flex flex-col gap-1.5 z-20">
          <div className="px-2.5 py-1 rounded bg-black/85 border border-slate-700/80 backdrop-blur-md text-[11px] font-mono tracking-widest text-emerald-400 font-bold flex items-center gap-2 shadow-lg">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            EDGE INFERENCE // NO VIDEO EGRESS // PII PURGED
          </div>
          {isFallbackActive ? (
            <div className="text-[10px] font-mono text-sky-300 bg-sky-950/80 border border-sky-500/30 px-2 py-0.5 rounded w-fit backdrop-blur-sm flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-sky-400 animate-pulse" />
              <span>SYNTHETIC 4-WAY TOPOLOGICAL TWIN // FALLBACK ACTIVE</span>
            </div>
          ) : (
            <div className="text-[10px] font-mono text-slate-400 bg-black/70 border border-slate-800/80 px-2 py-0.5 rounded w-fit backdrop-blur-sm">
              CAM_01_FPS: 25.0 // MODEL: YOLO26n+ByteTrack [CPU]
            </div>
          )}
        </div>

        {/* Fallback Schematic Mode */}
        {isFallbackActive ? (
          <IntersectionSchematic
            vehicles={activeVehicles}
            currentTime={currentTime}
            congestionActive={!!activeCongestionWindow}
          />
        ) : (
          /* HTML5 Video Element */
          <div className="relative w-full h-full flex items-center justify-center">
            <video
              ref={videoRef}
              src={videoSrc}
              muted={isMuted}
              playsInline
              preload="auto"
              onLoadedMetadata={() => {
                setIsVideoLoaded(true);
                setVideoError(false);
              }}
              onError={() => {
                console.warn('Video failed to load or videoSrc unreachable. Gracefully falling back to 4-way SVG schematic.');
                setVideoError(true);
              }}
              className="w-full h-full object-cover"
            />

            {/* Bounding Box Visual Overlay Over Video */}
            {showOverlays && (
              <div className="absolute inset-0 pointer-events-none">
                {activeVehicles.map((v) => {
                  const color = STATE_COLORS[v.state];
                  return (
                    <div
                      key={`bbox-${v.trackId}`}
                      style={{
                        left: `${v.x - v.w / 2}%`,
                        top: `${v.y - v.h / 2}%`,
                        width: `${v.w}%`,
                        height: `${v.h}%`,
                        borderColor: color.hex,
                        boxShadow: `0 0 10px ${color.glow}`,
                      }}
                      className="absolute border-2 rounded-sm transition-all duration-100 ease-out flex flex-col justify-between"
                    >
                      {/* Top Label Tag */}
                      <div
                        style={{ backgroundColor: color.hex }}
                        className="text-[9px] font-mono font-bold text-slate-950 px-1 py-0.5 rounded-t-sm truncate w-fit self-start -mt-4 shadow-sm"
                      >
                        {v.cls.substring(0, 4).toUpperCase()} #{v.trackId} · {v.speedKmh} km/h [{v.state}]
                      </div>

                      {/* Corner Target Marks */}
                      <div className="flex justify-between w-full p-0.5 opacity-60">
                        <span className="w-1.5 h-1.5 border-t border-l border-white" />
                        <span className="w-1.5 h-1.5 border-t border-r border-white" />
                      </div>
                      <div className="flex justify-between w-full p-0.5 opacity-60">
                        <span className="w-1.5 h-1.5 border-b border-l border-white" />
                        <span className="w-1.5 h-1.5 border-b border-r border-white" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Fallback Status Banner overlay when video fails */}
        {videoError && !manualFallbackToggle && (
          <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-950/90 border border-amber-500/40 text-amber-300 text-xs font-mono backdrop-blur-md">
            <VideoOff className="w-4 h-4 text-amber-400" />
            <span>CCTV OFFLINE // RENDERING EDGE TWIN SCHEMATIC</span>
          </div>
        )}
      </div>

      {/* =====================================================================
          3. LIVE KINEMATIC STATE BAR (DIRECTLY UNDERNEATH VIDEO)
          ===================================================================== */}
      <div className="flex flex-col gap-2 p-3.5 bg-slate-900 border-t border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <div className="flex items-center gap-2 font-bold text-slate-300">
            <Activity className="w-4 h-4 text-sky-400" />
            <span>LIVE KINEMATIC DISTRIBUTION</span>
            <span className="text-slate-500 font-normal">
              ({breakdown.total} active vehicles)
            </span>
          </div>

          {/* Formatted distribution breakdown as per prompt requirement */}
          <div className="flex flex-wrap items-center gap-x-2 text-[11px] font-semibold tracking-wide">
            <span className="text-[#ef4444]">
              IDLE: {breakdown.idle} ({breakdown.percentages.idle}%)
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-[#f59e0b]">
              ACCEL: {breakdown.accel} ({breakdown.percentages.accel}%)
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-[#10b981]">
              CRUISE: {breakdown.cruise} ({breakdown.percentages.cruise}%)
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-[#3b82f6]">
              DECEL: {breakdown.decel} ({breakdown.percentages.decel}%)
            </span>
          </div>
        </div>

        {/* Horizontal Proportional Distribution Bar */}
        <div className="w-full h-3.5 rounded-full bg-slate-950 overflow-hidden flex shadow-inner border border-slate-800/80">
          {/* IDLE Segment */}
          <div
            style={{ width: `${breakdown.percentages.idle}%` }}
            title={`IDLE: ${breakdown.idle} (${breakdown.percentages.idle}%)`}
            className="h-full bg-[#ef4444] transition-all duration-300 ease-out relative group"
          >
            <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>

          {/* ACCEL Segment */}
          <div
            style={{ width: `${breakdown.percentages.accel}%` }}
            title={`ACCEL: ${breakdown.accel} (${breakdown.percentages.accel}%)`}
            className="h-full bg-[#f59e0b] transition-all duration-300 ease-out relative group"
          >
            <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>

          {/* CRUISE Segment */}
          <div
            style={{ width: `${breakdown.percentages.cruise}%` }}
            title={`CRUISE: ${breakdown.cruise} (${breakdown.percentages.cruise}%)`}
            className="h-full bg-[#10b981] transition-all duration-300 ease-out relative group"
          >
            <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>

          {/* DECEL Segment */}
          <div
            style={{ width: `${breakdown.percentages.decel}%` }}
            title={`DECEL: ${breakdown.decel} (${breakdown.percentages.decel}%)`}
            className="h-full bg-[#3b82f6] transition-all duration-300 ease-out relative group"
          >
            <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>

        {/* Interactive KPI Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
          <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-950/70 border border-red-500/25">
            <div className="flex items-center gap-1.5 text-xs text-red-400 font-mono">
              <span className="w-2 h-2 rounded-full bg-[#ef4444]" />
              <span>IDLE</span>
            </div>
            <div className="text-xs font-mono font-bold text-red-300">
              {breakdown.idle} <span className="text-[10px] text-slate-500 font-normal">({breakdown.percentages.idle}%)</span>
            </div>
          </div>

          <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-950/70 border border-amber-500/25">
            <div className="flex items-center gap-1.5 text-xs text-amber-400 font-mono">
              <span className="w-2 h-2 rounded-full bg-[#f59e0b]" />
              <span>ACCEL</span>
            </div>
            <div className="text-xs font-mono font-bold text-amber-300">
              {breakdown.accel} <span className="text-[10px] text-slate-500 font-normal">({breakdown.percentages.accel}%)</span>
            </div>
          </div>

          <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-950/70 border border-emerald-500/25">
            <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
              <span className="w-2 h-2 rounded-full bg-[#10b981]" />
              <span>CRUISE</span>
            </div>
            <div className="text-xs font-mono font-bold text-emerald-300">
              {breakdown.cruise} <span className="text-[10px] text-slate-500 font-normal">({breakdown.percentages.cruise}%)</span>
            </div>
          </div>

          <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-950/70 border border-blue-500/25">
            <div className="flex items-center gap-1.5 text-xs text-blue-400 font-mono">
              <span className="w-2 h-2 rounded-full bg-[#3b82f6]" />
              <span>DECEL</span>
            </div>
            <div className="text-xs font-mono font-bold text-blue-300">
              {breakdown.decel} <span className="text-[10px] text-slate-500 font-normal">({breakdown.percentages.decel}%)</span>
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================================
          2. SYNCED TIMELINE SCRUBBER & SLEEK CONTROLS
          ===================================================================== */}
      <div className="p-4 bg-slate-950/90 border-t border-slate-800 flex flex-col gap-3">
        {/* Scrubber Track Area */}
        <div className="relative flex flex-col gap-1.5">
          {/* Header Time Readout & Hover Preview */}
          <div className="flex justify-between items-center text-xs font-mono">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-200 font-bold">{formatTime(currentTime)}</span>
              <span className="text-slate-600">/</span>
              <span className="text-slate-400">{formatTime(duration)}</span>
            </div>

            {/* Congestion Notice */}
            <div className="flex items-center gap-2">
              {activeCongestionWindow && (
                <span className="text-red-400 text-[11px] font-semibold animate-pulse">
                  ⚠️ {activeCongestionWindow.label}
                </span>
              )}
            </div>
          </div>

          {/* Interactive Timeline Track Container */}
          <div
            className="relative w-full h-7 flex items-center cursor-pointer group"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              setScrubberHoverTime(Number((pos * duration).toFixed(1)));
            }}
            onMouseLeave={() => setScrubberHoverTime(null)}
          >
            {/* Base Background Track */}
            <div className="w-full h-2 rounded-full bg-slate-800/90 relative overflow-hidden">
              {/* Congestion Window Markers (Mini colored bands indicating heavy idle congestion) */}
              {congestionWindows.map((cw, idx) => {
                const leftPct = (cw.start / duration) * 100;
                const widthPct = ((cw.end - cw.start) / duration) * 100;
                return (
                  <div
                    key={`cong-win-${idx}`}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    className="absolute top-0 bottom-0 bg-red-500/40 border-l border-r border-red-500/80 group-hover:bg-red-500/60 transition-colors"
                    title={`Congestion Window: ${cw.label} (${cw.start}s - ${cw.end}s)`}
                  />
                );
              })}

              {/* Progress Played Fill */}
              <div
                style={{ width: `${(currentTime / duration) * 100}%` }}
                className="h-full bg-gradient-to-r from-sky-500 to-emerald-400 relative"
              />
            </div>

            {/* Congestion Mini Markers (Pins) on Track */}
            {congestionWindows.map((cw, idx) => {
              const leftPct = (cw.start / duration) * 100;
              return (
                <div
                  key={`pin-${idx}`}
                  style={{ left: `${leftPct}%` }}
                  className="absolute -top-1 w-1.5 h-4 bg-red-500 rounded-sm shadow-sm pointer-events-none"
                  title={cw.label}
                />
              );
            })}

            {/* Hidden native range input for accessible dragging */}
            <input
              type="range"
              min={0}
              max={duration}
              step={0.1}
              value={currentTime}
              onChange={(e) => handleSeek(parseFloat(e.target.value))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              aria-label="Timeline Scrubber"
            />

            {/* Current Scrubber Thumb / Needle */}
            <div
              style={{ left: `${(currentTime / duration) * 100}%` }}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white border-2 border-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)] pointer-events-none transition-transform group-hover:scale-125"
            />

            {/* Hover Tooltip Preview */}
            {scrubberHoverTime !== null && (
              <div
                style={{ left: `${(scrubberHoverTime / duration) * 100}%` }}
                className="absolute -top-7 -translate-x-1/2 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-mono text-slate-200 pointer-events-none shadow-lg whitespace-nowrap z-20"
              >
                {formatTime(scrubberHoverTime)}
              </div>
            )}
          </div>
        </div>

        {/* Sleek Control Bar (Play/Pause, Frame Step, Speeds, Fullscreen) */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {/* Left Transport Controls */}
          <div className="flex items-center gap-2">
            {/* Play / Pause */}
            <button
              onClick={togglePlay}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-sky-500 hover:bg-sky-400 active:scale-95 text-slate-950 font-bold transition-all shadow-md shadow-sky-500/20"
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
            </button>

            {/* Frame Step Backward (-0.1s) */}
            <button
              onClick={() => stepFrame(-0.1)}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
              title="Step Backward 0.1s (Left Arrow)"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            {/* Frame Step Forward (+0.1s) */}
            <button
              onClick={() => stepFrame(0.1)}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
              title="Step Forward 0.1s (Right Arrow)"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            {/* Reset to Start */}
            <button
              onClick={() => handleSeek(0)}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
              title="Rewind to 0.0s"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            {/* Audio Toggle */}
            <button
              onClick={() => setIsMuted(!isMuted)}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
            </button>
          </div>

          {/* Right Controls: Playback Speeds & Fullscreen */}
          <div className="flex items-center gap-3">
            {/* Playback Speed Selector (0.5x, 1.0x, 2.0x) */}
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono">
              <span className="text-slate-500 px-1 flex items-center">
                <Gauge className="w-3 h-3 mr-1" />
              </span>
              {[0.5, 1.0, 2.0].map((speed) => (
                <button
                  key={`speed-${speed}`}
                  onClick={() => setPlaybackSpeed(speed)}
                  className={`px-2 py-0.5 rounded text-xs transition-colors font-medium ${
                    playbackSpeed === speed
                      ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40 font-bold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  {speed.toFixed(1)}x
                </button>
              ))}
            </div>

            {/* Fullscreen Button */}
            <button
              onClick={toggleFullscreen}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default JunctionKinematicPlayer;
