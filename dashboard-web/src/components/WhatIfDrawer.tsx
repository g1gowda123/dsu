"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { VEHICLE_CLASSES, type Directive, type VehicleClass } from "@/lib/data";
import { emptyScenario, runScenario, annualized, baselineKg, windowLabel, type Scenario } from "@/lib/sim";
import { Num } from "@/components/Num";

const CLASS_LABEL: Record<VehicleClass, string> = {
  car: "Car",
  motorcycle: "Motorcycle",
  auto_rickshaw: "Auto rickshaw",
  bus: "Bus",
  truck: "Truck",
};

const kgFmt = (n: number) =>
  n > 0.0005 ? `−${n.toFixed(2)} kg CO₂` : "0.00 kg CO₂";
const pctFmt = (n: number) =>
  n > 0.05 ? `−${n.toFixed(1)}% vs baseline` : "0.0% vs baseline";

function scenarioFromDirective(d: Directive | null, base: Scenario): Scenario {
  if (!d) return base;
  const green = d.actions?.find(
    (a) => (a.type === "extend_green" || a.type === "green_wave_priority") && a.seconds && a.seconds > 0,
  );
  const heavy = d.actions?.some((a) => a.type === "heavy_vehicle_restriction");
  return {
    ...base,
    greenExtensionS: green?.seconds ?? 0,
    heavyRestriction: heavy,
  };
}

function ScenarioRow({
  scenario,
  setScenario,
}: {
  scenario: Scenario;
  setScenario: (fn: (s: Scenario) => Scenario) => void;
}) {
  const result = useMemo(() => runScenario(scenario), [scenario]);
  const annualised = useMemo(() => annualized(result.deltaKg), [result.deltaKg]);

  const baselinePct = 100;
  const scenarioPct = baselineKg > 0 ? (result.scenarioKg / baselineKg) * 100 : 0;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-h-0 flex-col overflow-y-auto border-b border-line md:border-b-0 md:border-r">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h3 className="flex items-center gap-2 text-xs font-medium tracking-wide text-fg">
            <SlidersHorizontal className="h-3.5 w-3.5 text-fg-mute" aria-hidden />
            Levers
          </h3>
          <button
            onClick={() => setScenario(() => emptyScenario())}
            className="flex items-center gap-1.5 text-[11px] text-fg-dim transition-colors hover:text-fg"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            Reset
          </button>
        </div>

        <div className="px-5 py-2">
          {VEHICLE_CLASSES.map((cls) => (
            <div key={cls} className="flex items-center gap-3 border-b border-line-soft py-3 last:border-0">
              <label
                htmlFor={`ev-${cls}`}
                className="w-28 shrink-0 text-xs text-fg-mute"
              >
                {CLASS_LABEL[cls]}
              </label>
              <input
                id={`ev-${cls}`}
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round((scenario.evShare[cls] ?? 0) * 100)}
                onChange={(e) =>
                  setScenario((s) => ({
                    ...s,
                    evShare: { ...s.evShare, [cls]: Number(e.target.value) / 100 },
                  }))
                }
                className="flex-1"
              />
              <span className="num w-12 shrink-0 text-right text-xs text-fg">
                {Math.round((scenario.evShare[cls] ?? 0) * 100)}%
              </span>
            </div>
          ))}

          <div className="mt-4 border-t border-line">
            <div className="flex items-center gap-3 py-3">
              <label htmlFor="green-ext" className="w-28 shrink-0 text-xs text-fg-mute">
                Green extension
              </label>
              <input
                id="green-ext"
                type="range"
                min={0}
                max={15}
                step={1}
                value={scenario.greenExtensionS}
                onChange={(e) =>
                  setScenario((s) => ({ ...s, greenExtensionS: Number(e.target.value) }))
                }
                className="flex-1"
              />
              <span className="num w-12 shrink-0 text-right text-xs text-fg">
                {scenario.greenExtensionS}s
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-line py-3">
            <span className="text-xs text-fg-mute">Heavy-vehicle restriction</span>
            <button
              role="switch"
              aria-checked={scenario.heavyRestriction}
              onClick={() => setScenario((s) => ({ ...s, heavyRestriction: !s.heavyRestriction }))}
              className={`num border px-2.5 py-1 text-[10px] tracking-wider transition-colors ${
                scenario.heavyRestriction
                  ? "border-live text-live"
                  : "border-line text-fg-dim hover:text-fg-mute"
              }`}
            >
              {scenario.heavyRestriction ? "ON" : "OFF"}
            </button>
          </div>

          <p className="border-t border-line py-3 text-[10px] leading-relaxed text-fg-dim">
            EV share scales tailpipe emissions to zero per class. Green extension attenuates
            idle-linked emissions up to 60% at 15 s. Restriction holds heavy-vehicle momentum.
          </p>
        </div>
      </div>

      <div className="flex flex-col justify-center gap-5 bg-panel px-5 py-6">
        <span className="text-[10px] uppercase tracking-wider text-fg-dim">
          Payoff · {windowLabel()}
        </span>

        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-fg-mute">Baseline</span>
            <span className="num text-xs text-fg-mute">{baselineKg.toFixed(2)} kg</span>
          </div>
          <div className="h-1 bg-line">
            <div
              className="h-full origin-left bg-fg-mute"
              style={{ transform: `scaleX(${baselinePct / 100})`, transition: "transform 180ms ease-out" }}
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-fg">Scenario</span>
            <span className="num text-xs text-fg">{result.scenarioKg.toFixed(2)} kg</span>
          </div>
          <div className="h-1 bg-line">
            <div
              className="h-full origin-left bg-live"
              style={{ transform: `scaleX(${scenarioPct / 100})`, transition: "transform 180ms ease-out" }}
            />
          </div>
        </div>

        <div className="border-t border-line pt-5">
          <span className="text-[10px] uppercase tracking-wider text-fg-dim">
            Avoided in window
          </span>
          <div className="num mt-2 text-4xl leading-none tracking-tight text-live">
            <Num value={result.deltaKg} format={kgFmt} />
          </div>
          <div className="num mt-2 text-sm text-fg-mute">
            <Num value={result.deltaPct} format={pctFmt} />
          </div>
        </div>

        <div className="num space-y-1 border-t border-line pt-4 text-[10px] text-fg-dim">
          <div className="flex justify-between">
            <span>idle-linked</span>
            <span>{result.greenSavingKg.toFixed(2)} kg</span>
          </div>
          <div className="flex justify-between">
            <span>emission source</span>
            <span>cctv telemetry</span>
          </div>
        </div>

        <div className="num space-y-1 border-t border-line pt-4 text-[10px] text-fg-dim">
          <span className="block pb-1 uppercase tracking-wider">Annualised · 24×7 extrapolation</span>
          <div className="flex justify-between">
            <span>CO₂ avoided</span>
            <span className="text-fg-mute">
              {annualised.tonnesPerYear >= 1
                ? `${annualised.tonnesPerYear.toFixed(1)} t/yr`
                : `${(annualised.tonnesPerYear * 1000).toFixed(0)} kg/yr`}
            </span>
          </div>
          <div className="flex justify-between">
            <span>fuel cost saved</span>
            <span className="text-fg-mute">
              ₹{Math.round(annualised.inrPerYear).toLocaleString("en-IN")}/yr
            </span>
          </div>
          <div className="flex justify-between">
            <span>tree-years equiv.</span>
            <span className="text-fg-mute">
              {annualised.treeYears >= 1000
                ? `${(annualised.treeYears / 1000).toFixed(1)}k`
                : annualised.treeYears.toFixed(0)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WhatIfDrawer({
  directive,
  onClose,
}: {
  directive: Directive | null;
  onClose: () => void;
}) {
  const [scenario, setScenario] = useState<Scenario>(() =>
    scenarioFromDirective(directive, emptyScenario()),
  );

  return (
    <div className="fixed inset-0 z-50">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
        className="absolute inset-y-0 right-0 w-full max-w-[900px] border-l border-line bg-bg"
      >
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-between border-b border-line px-5 py-3">
            <div className="flex items-baseline gap-3">
              <h2 className="text-sm font-medium tracking-tight text-fg">
                What-If simulator
              </h2>
              {directive ? (
                <span className="num truncate text-[10px] text-fg-dim">
                  loaded {directive.directive_id ?? "—"}
                </span>
              ) : (
                <span className="text-[10px] text-fg-dim">manual scenario</span>
              )}
            </div>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center border border-line text-fg-mute transition-colors hover:text-fg"
              aria-label="Close What-If simulator"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </header>

          <div className="min-h-0 flex-1">
            <ScenarioRow scenario={scenario} setScenario={setScenario} />
          </div>
        </div>
      </motion.div>
    </div>
  );
}
