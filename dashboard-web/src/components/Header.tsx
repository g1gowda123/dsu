'use client';

import React, { useState, useEffect } from 'react';
import {
  Activity,
  ShieldCheck,
  Cpu,
  Wifi,
  Radio,
  ChevronDown,
  FileText,
  Clock,
  Sparkles,
  Download,
} from 'lucide-react';
import { JUNCTIONS } from '@/data/mockData';
import { JunctionMetadata } from '@/types/dashboard';

interface HeaderProps {
  currentJunction: JunctionMetadata;
  onSelectJunction: (junction: JunctionMetadata) => void;
  onOpenMethodology: () => void;
  onExportAudit: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentJunction,
  onSelectJunction,
  onOpenMethodology,
  onExportAudit,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState<string>('11:29:33 IST');

  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      setCurrentTime(`${hours}:${minutes}:${seconds} IST`);
    };
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#1f293d] bg-[#090d16]/95 backdrop-blur-md px-4 py-2.5 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-3 max-w-[1920px] mx-auto">
        
        {/* Left Section: Branding & Junction Picker */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
              <Activity className="h-5 w-5 animate-pulse" />
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold tracking-widest text-emerald-400 uppercase">
                  ECO-KINETIC TWIN
                </span>
                <span className="text-xs font-mono text-slate-500">//</span>
                <span className="text-xs font-semibold tracking-wider text-slate-300 uppercase">
                  Municipal Carbon Intelligence
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-mono tracking-tight">
                Edge Digital Twin • Deterministic BS-VI Emission Model • Zero-PII Egress
              </p>
            </div>
          </div>

          <div className="h-6 w-px bg-[#1f293d] hidden sm:block" />

          {/* Junction Selector */}
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#111827] border border-[#1f293d] hover:border-emerald-500/50 text-slate-200 text-xs font-medium transition-all shadow-inner"
            >
              <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-semibold text-slate-100">{currentJunction.name}</span>
              <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {dropdownOpen && (
              <div className="absolute left-0 mt-1.5 w-80 rounded-lg bg-[#111827] border border-[#1f293d] shadow-2xl z-50 py-1 overflow-hidden">
                <div className="px-3 py-1.5 text-[10px] uppercase font-mono tracking-wider text-slate-400 border-b border-[#1f293d]">
                  Select Municipal CCTV Intersection
                </div>
                {JUNCTIONS.map((j) => (
                  <button
                    key={j.id}
                    onClick={() => {
                      onSelectJunction(j);
                      setDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-[#1a2333] transition-colors ${
                      j.id === currentJunction.id ? 'bg-emerald-500/10 text-emerald-300 font-medium' : 'text-slate-300'
                    }`}
                  >
                    <div>
                      <div className="font-semibold">{j.name}</div>
                      <div className="text-[10px] text-slate-500">{j.corridor}</div>
                    </div>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#090d16] text-slate-400 border border-[#1f293d]">
                      {j.edgeFps} FPS
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Section: System Badges & Actions */}
        <div className="flex flex-wrap items-center gap-2">
          
          {/* Badge: Edge CPU */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#111827] border border-[#1f293d] text-[11px] font-mono text-slate-300">
            <Cpu className="h-3.5 w-3.5 text-cyan-400" />
            <span className="text-slate-400">Edge CPU:</span>
            <span className="font-semibold text-cyan-300">{currentJunction.edgeFps} FPS</span>
          </div>

          {/* Badge: Privacy */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-950/40 border border-emerald-500/30 text-[11px] font-mono text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.15)]">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-emerald-400/80">Privacy:</span>
            <span className="font-bold">Zero-PII Egress</span>
          </div>

          {/* Badge: Uplink */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#111827] border border-[#1f293d] text-[11px] font-mono text-slate-300">
            <Wifi className="h-3.5 w-3.5 text-sky-400" />
            <span className="text-slate-400">Uplink:</span>
            <span className="font-semibold text-sky-300">{currentJunction.uplinkKbMin} KB/min</span>
          </div>

          {/* Badge: Mode */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-950/30 border border-amber-500/30 text-[11px] font-mono text-amber-300">
            <Radio className="h-3.5 w-3.5 text-amber-400 animate-pulse" />
            <span className="text-amber-400/80">Mode:</span>
            <span className="font-bold">Active Twin</span>
          </div>

          {/* Clock */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#090d16] border border-[#1f293d] text-[11px] font-mono text-slate-400">
            <Clock className="h-3.5 w-3.5 text-slate-500" />
            <span className="tabular-nums font-medium text-slate-200">{currentTime}</span>
          </div>

          {/* Methodology Button */}
          <button
            onClick={onOpenMethodology}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#111827] border border-[#1f293d] hover:border-emerald-500/50 hover:bg-[#162032] text-[11px] font-medium text-slate-300 transition-all cursor-pointer shadow-sm hover:text-emerald-300"
            title="Audit Methodology & Factors"
            aria-label="Audit Methodology & Factors"
          >
            <FileText className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <span className="hidden lg:inline">Audit Methodology &amp; Factors</span>
            <span className="hidden sm:inline lg:hidden">Methodology &amp; Factors</span>
            <span className="sm:hidden">Methodology</span>
          </button>

          {/* Export Audit Report */}
          <button
            onClick={onExportAudit}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-[11px] font-bold transition-all shadow-md cursor-pointer"
            title="Export ICCC Telemetry & Audit Report"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Export Audit</span>
          </button>

        </div>

      </div>
    </header>
  );
};
