'use client';

import React from 'react';
import { X, FileText, CheckCircle, ShieldCheck, Cpu, Database } from 'lucide-react';
import { EMISSION_FACTORS } from '@/data/mockData';

interface MethodologyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MethodologyModal: React.FC<MethodologyModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="command-card rounded-2xl max-w-3xl w-full p-6 border border-emerald-500/40 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-slate-400 hover:text-slate-100 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2 text-emerald-400 font-mono text-xs font-bold uppercase mb-1">
          <FileText className="h-4 w-4" />
          Technical Specification & Emission Methodology
        </div>

        <h2 className="text-xl font-bold text-slate-100 mb-1">
          Deterministic BS-VI Traffic Carbon Digital Twin
        </h2>
        <p className="text-xs text-slate-400 font-mono mb-4">
          Citations, kinematic state formulas, and emission factors as defined in <code>config/emission_factors.yaml</code>.
        </p>

        {/* Guardrails Banner */}
        <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-xs font-mono text-emerald-300 mb-5 leading-relaxed flex items-start gap-2.5">
          <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <strong>Zero-PII & Deterministic Carbon Math:</strong> Design strictly prevents video stream egress from edge CCTV nodes. Telemetry is purely tabular bounding-box coordinates and speed vectors. LLMs never compute emission numbers; all carbon mathematics are deterministic Python functions.
          </div>
        </div>

        {/* Section 1: 5-Class Emission Matrix Table */}
        <div className="mb-5">
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300 mb-2">
            1. Per-Class Emission Factor Matrix (CPCB / ARAI / EPA MOVES3)
          </h3>
          <div className="overflow-x-auto rounded-lg border border-[#1f293d]">
            <table className="w-full text-left font-mono text-xs">
              <thead className="bg-[#090d16] text-slate-400 border-b border-[#1f293d]">
                <tr>
                  <th className="p-2.5">Taxonomy</th>
                  <th className="p-2.5">Idle (g/min)</th>
                  <th className="p-2.5">Cruise (g/km)</th>
                  <th className="p-2.5">Accel Mult</th>
                  <th className="p-2.5">Mean Length</th>
                  <th className="p-2.5">Primary Citation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1f293d] bg-[#111827]">
                {Object.entries(EMISSION_FACTORS).map(([key, item]) => (
                  <tr key={key} className="hover:bg-[#1a2333]">
                    <td className="p-2.5 font-bold text-slate-200 capitalize flex items-center gap-1.5">
                      <span style={{ color: item.color }}>●</span>
                      <span>{item.label}</span>
                    </td>
                    <td className="p-2.5 text-rose-400 font-semibold">{item.idle_g_per_min}</td>
                    <td className="p-2.5 text-sky-400 font-semibold">{item.cruise_g_per_km}</td>
                    <td className="p-2.5 text-amber-400 font-semibold">{item.accel_multiplier}x</td>
                    <td className="p-2.5 text-slate-300">{item.mean_length_m}m</td>
                    <td className="p-2.5 text-[11px] text-slate-400 truncate max-w-xs" title={item.source}>
                      {item.source}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section 2: Kinematic Equations & State Machine */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5 font-mono text-xs">
          
          <div className="p-3.5 rounded-lg bg-[#090d16] border border-[#1f293d]">
            <h4 className="font-bold text-slate-200 mb-2 text-[11px] uppercase tracking-wider text-sky-400">
              2. Kinematic Velocity Proxy
            </h4>
            <div className="p-2 rounded bg-[#111827] text-slate-300 mb-2 text-[11px]">
              <code>v_bls = |Δcentroid| / bbox_width_px</code><br />
              <code>v_kmh = v_bls × MEAN_LENGTH_M[class] × 3.6</code><br />
              <code>v_smoothed = EMA(v_kmh, alpha=0.3)</code>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Enables real-time ground-speed estimation directly from uncalibrated CCTV angles using the vehicle&apos;s observed physical pixel width as a dynamic distance scale.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-[#090d16] border border-[#1f293d]">
            <h4 className="font-bold text-slate-200 mb-2 text-[11px] uppercase tracking-wider text-amber-400">
              3. 4-State Machine Specification
            </h4>
            <ul className="space-y-1.5 text-[11px] text-slate-300">
              <li>
                <strong className="text-rose-400">IDLE:</strong> v &lt; 2 km/h for &gt; 3s (after exceeding 5 km/h)
              </li>
              <li>
                <strong className="text-amber-400">ACCEL:</strong> dv/dt &gt; threshold, or v 5→15 km/h within 5s
              </li>
              <li>
                <strong className="text-emerald-400">CRUISE:</strong> 15–50 km/h steady cruising speed
              </li>
              <li>
                <strong className="text-sky-400">DECEL:</strong> Braking / negative acceleration beyond threshold
              </li>
            </ul>
          </div>

        </div>

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-mono font-bold text-xs transition-colors cursor-pointer"
        >
          Close Methodology Inspector
        </button>

      </div>
    </div>
  );
};
