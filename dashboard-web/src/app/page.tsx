'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Header } from '@/components/Header';
import { MetricKpiGrid } from '@/components/MetricKpiGrid';
import { CctvPlayer } from '@/components/CctvPlayer';
import { RollingEmissionChart } from '@/components/RollingEmissionChart';
import { SpatialChokeMatrix } from '@/components/SpatialChokeMatrix';
import { MunicipalDispatchFeed } from '@/components/MunicipalDispatchFeed';
import { SimulationStudio } from '@/components/SimulationStudio';
import { MethodologyModal } from '@/components/MethodologyModal';
import {
  JUNCTIONS,
  generateTelemetryData,
  CHOKE_MATRIX,
  INITIAL_DIRECTIVES,
} from '@/data/mockData';
import {
  JunctionMetadata,
  ChokeZone,
  MunicipalDirective,
  SimulationParams,
} from '@/types/dashboard';
import { CheckCircle2, Download, X } from 'lucide-react';

export default function DashboardPage() {
  // Junction state
  const [currentJunction, setCurrentJunction] = useState<JunctionMetadata>(JUNCTIONS[0]);

  // Telemetry data
  const telemetryData = useMemo(() => generateTelemetryData(), []);

  // Playback state
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(36); // Start around choke peak
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);

  // Choke Matrix & Selected Zone
  const [zones, setZones] = useState<ChokeZone[]>(CHOKE_MATRIX);
  const [selectedZone, setSelectedZone] = useState<ChokeZone | null>(
    CHOKE_MATRIX.find((z) => z.zoneId === 'Z_1_2') || null
  );

  // Directives Feed
  const [directives, setDirectives] = useState<MunicipalDirective[]>(INITIAL_DIRECTIVES);

  // Simulation Parameters
  const [simParams, setSimParams] = useState<SimulationParams>({
    evPenetration: {
      car: 0,
      motorcycle: 0,
      auto_rickshaw: 0,
      bus: 0,
      truck: 0,
    },
    adaptiveGreenExtensionSec: 0,
    heavyVehiclePeakRestriction: false,
    fuelPriceInr: 100,
  });

  // Modal & Toast states
  const [isMethodologyOpen, setIsMethodologyOpen] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Playback loop
  useEffect(() => {
    if (!isPlaying) return;

    const intervalMs = 1000 / playbackSpeed;
    const timer = setInterval(() => {
      setCurrentTimeSec((prev) => {
        if (prev >= 120) return 0;
        return prev + 1;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isPlaying, playbackSpeed]);

  // Current Telemetry slice
  const currentTelemetry = useMemo(() => {
    const roundedSec = Math.floor(currentTimeSec / 2) * 2;
    return (
      telemetryData.find((t) => t.timestampSec === roundedSec) ||
      telemetryData[telemetryData.length - 1]
    );
  }, [currentTimeSec, telemetryData]);

  // Handlers for Directives
  const handleApproveDirective = (id: string) => {
    setDirectives((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status: 'approved' } : d))
    );
    showToast(`Directive ${id} approved. Ready to dispatch.`);
  };

  const handleDispatchToAtcs = (id: string) => {
    setDirectives((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status: 'dispatched' } : d))
    );
    showToast(`Directive ${id} successfully pushed to SCATS/ATCS Controller.`);
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleExportAudit = () => {
    // Generate and download a JSON telemetry audit bundle
    const auditData = {
      junction: currentJunction,
      timestamp: new Date().toISOString(),
      activeTimeSec: currentTimeSec,
      telemetrySnapshot: currentTelemetry,
      activeDirectives: directives,
      chokeMatrix: zones,
      simulationParams: simParams,
    };
    const blob = new Blob([JSON.stringify(auditData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eco_kinetic_telemetry_audit_${currentJunction.id}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Audit file exported: eco_kinetic_telemetry_audit_${currentJunction.id}.json`);
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col">
      {/* Top Header Bar */}
      <Header
        currentJunction={currentJunction}
        onSelectJunction={(j) => {
          setCurrentJunction(j);
          showToast(`Switched junction feed to ${j.name}`);
        }}
        onOpenMethodology={() => setIsMethodologyOpen(true)}
        onExportAudit={handleExportAudit}
      />

      {/* Main Workspace Container */}
      <main className="flex-1 max-w-[1920px] w-full mx-auto px-4 py-4 flex flex-col gap-4">
        
        {/* Module 1: Top Metric KPI Grid (5 Cards) */}
        <MetricKpiGrid
          currentTelemetry={currentTelemetry}
          totalTracked={currentTelemetry.trackedCount}
          cumulativeCo2={currentTelemetry.cumulativeCO2_kg}
          idleShare={currentTelemetry.idleSharePct}
          heavyStopEvents={28}
          topChokePoint={{
            zoneId: 'Z_1_2',
            label: 'North Stopline (CRITICAL)',
            idleMins: 2.4,
            intensity: 'critical',
          }}
        />

        {/* Module 2: Center Workspace (2-Column Grid: 60% Left, 40% Right) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          
          {/* Column Left (60% ~ 7 cols): CCTV Player & Rolling Emission Chart */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            <CctvPlayer
              currentTimeSec={currentTimeSec}
              onTimeChange={setCurrentTimeSec}
              isPlaying={isPlaying}
              onTogglePlay={() => setIsPlaying(!isPlaying)}
              playbackSpeed={playbackSpeed}
              onChangeSpeed={setPlaybackSpeed}
              activeStateCounts={currentTelemetry.byStateCount}
            />

            <RollingEmissionChart
              telemetryData={telemetryData}
              currentTimeSec={currentTimeSec}
              onSeekTime={setCurrentTimeSec}
            />
          </div>

          {/* Column Right (40% ~ 5 cols): Spatial Choke Matrix & Municipal Dispatch Feed */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            <SpatialChokeMatrix
              zones={zones}
              selectedZone={selectedZone}
              onSelectZone={setSelectedZone}
            />

            <MunicipalDispatchFeed
              directives={directives}
              onApproveDirective={handleApproveDirective}
              onDispatchToAtcs={handleDispatchToAtcs}
            />
          </div>

        </div>

        {/* Module 3: Bottom Drawer / Section: What-If Policy Simulation Studio */}
        <SimulationStudio
          params={simParams}
          onChangeParams={setSimParams}
          baselineCo2={currentTelemetry.cumulativeCO2_kg}
        />

      </main>

      {/* Footer System Status Bar */}
      <footer className="w-full border-t border-[#1f293d] bg-[#090d16] px-4 py-2 text-[10px] font-mono text-slate-500 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            ICCC GATEWAY CONNECTED
          </span>
          <span>•</span>
          <span>INGEST: RTSP / 1080p H.264</span>
          <span>•</span>
          <span>TRACKING: BYTETRACK v2</span>
          <span>•</span>
          <span>TAXONOMY: 5-CLASS (IDD + COCO)</span>
        </div>
        <div className="flex items-center gap-2">
          <span>OPERATOR: MUNICIPAL TRAFFIC POLICE HQ</span>
          <span>•</span>
          <span className="text-slate-400">SESSION ID: EK-TWIN-2026-BENGALURU</span>
        </div>
      </footer>

      {/* Methodology Modal */}
      <MethodologyModal
        isOpen={isMethodologyOpen}
        onClose={() => setIsMethodologyOpen(false)}
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-emerald-950 border border-emerald-500/50 text-emerald-200 text-xs font-mono shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="text-emerald-400/60 hover:text-emerald-300 ml-2"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
