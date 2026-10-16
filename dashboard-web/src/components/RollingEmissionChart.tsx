'use client';

import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';
import { TelemetryPoint } from '@/types/dashboard';
import { AlertCircle, TrendingUp, Zap } from 'lucide-react';

interface RollingEmissionChartProps {
  telemetryData: TelemetryPoint[];
  currentTimeSec: number;
  onSeekTime: (timeSec: number) => void;
}

export const RollingEmissionChart: React.FC<RollingEmissionChartProps> = ({
  telemetryData,
  currentTimeSec,
  onSeekTime,
}) => {
  const currentPoint =
    telemetryData.find((p) => p.timestampSec === currentTimeSec) ||
    telemetryData[Math.min(Math.floor(currentTimeSec / 2), telemetryData.length - 1)];

  return (
    <div className="command-card rounded-xl p-4 flex flex-col gap-3">
      {/* Chart Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1f293d] pb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
            <Zap className="h-4 w-4 text-amber-400" />
            Rolling Carbon Emission Rate (g CO₂ / sec)
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#090d16] text-slate-400 border border-[#1f293d]">
            dt = 2.0s Telemetry
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono">
          <div className="flex items-center gap-1.5 text-rose-400">
            <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
            <span>Spike Threshold: 38.0 g/s</span>
          </div>
          <div className="flex items-center gap-1.5 text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span>Instant: {currentPoint?.emissionRate_gs} g/s</span>
          </div>
        </div>
      </div>

      {/* Chart Viewport */}
      <div className="h-[210px] w-full pt-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={telemetryData}
            onClick={(e: any) => {
              if (e && e.activePayload && e.activePayload.length > 0) {
                const clickedSec = e.activePayload[0].payload.timestampSec;
                onSeekTime(clickedSec);
              }
            }}
            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id="emissionGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.6} />
                <stop offset="60%" stopColor="#f59e0b" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#1f293d" vertical={false} />

            <XAxis
              dataKey="timestampSec"
              stroke="#64748b"
              fontSize={10}
              tickFormatter={(v) => `${v}s`}
              tickLine={false}
              axisLine={{ stroke: '#1f293d' }}
            />

            <YAxis
              stroke="#64748b"
              fontSize={10}
              domain={[0, 60]}
              tickFormatter={(v) => `${v}g`}
              tickLine={false}
              axisLine={{ stroke: '#1f293d' }}
            />

            {/* Threshold Line */}
            <ReferenceLine
              y={38}
              stroke="#f43f5e"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{
                value: 'IDLE CHOKE SPIKE (38 g/s)',
                fill: '#f43f5e',
                fontSize: 9,
                position: 'top',
                fontFamily: 'monospace',
              }}
            />

            {/* Current Playhead Scrubber Line */}
            <ReferenceLine
              x={currentTimeSec}
              stroke="#10b981"
              strokeWidth={2}
              label={{
                value: `T: ${currentTimeSec}s`,
                fill: '#10b981',
                fontSize: 10,
                position: 'insideTopRight',
                fontFamily: 'monospace',
              }}
            />

            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const d = payload[0].payload as TelemetryPoint;
                const isOverThreshold = d.emissionRate_gs >= 38.0;

                return (
                  <div className="rounded-lg bg-[#090d16] border border-[#1f293d] p-3 shadow-xl text-xs font-mono">
                    <div className="flex items-center justify-between gap-4 border-b border-[#1f293d] pb-1.5 mb-2">
                      <span className="text-slate-400">Timeline: {d.timestampSec}s</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          isOverThreshold
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        }`}
                      >
                        {isOverThreshold ? 'CHOKE BREACH' : 'NORMAL'}
                      </span>
                    </div>

                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-slate-400">Rate:</span>
                      <span className="text-sm font-bold text-slate-100">
                        {d.emissionRate_gs} g CO₂/s
                      </span>
                    </div>

                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-slate-400">Corridor Idle:</span>
                      <span className="text-rose-400 font-bold">{d.idleSharePct}%</span>
                    </div>

                    <div className="flex justify-between items-baseline mb-2">
                      <span className="text-slate-400">Cumulative CO₂:</span>
                      <span className="text-amber-400">{d.cumulativeCO2_kg} kg</span>
                    </div>

                    <div className="border-t border-[#1f293d] pt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
                      <div>🚗 Car: {d.byClassEmission.car} g/s</div>
                      <div>🛵 2W: {d.byClassEmission.motorcycle} g/s</div>
                      <div>🛺 Auto: {d.byClassEmission.auto_rickshaw} g/s</div>
                      <div>🚌 Bus: {d.byClassEmission.bus} g/s</div>
                      <div className="col-span-2">🚛 Truck: {d.byClassEmission.truck} g/s</div>
                    </div>
                  </div>
                );
              }}
            />

            <Area
              type="monotone"
              dataKey="emissionRate_gs"
              stroke="#f43f5e"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#emissionGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
