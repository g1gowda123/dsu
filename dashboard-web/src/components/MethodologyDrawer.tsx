"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { data, VEHICLE_CLASSES, fmtNum } from "@/lib/data";

export function MethodologyDrawer() {
  const [open, setOpen] = useState(false);

  return (
    <footer className="sticky bottom-0 z-30 border-t border-line bg-bg">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-10 w-full items-center justify-between px-6"
      >
        <span className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-fg-mute">
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${open ? "" : "rotate-180"}`}
            aria-hidden
          />
          Methodology
        </span>
        <span className="num flex items-center gap-2 text-[10px] text-fg-dim">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          no video leaves the edge · zero PII
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="overflow-hidden border-t border-line bg-panel"
          >
            <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-8 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_420px]">
              <div>
                <h3 className="text-xs font-medium text-fg">How numbers are produced</h3>
                <p className="mt-2 max-w-prose text-sm leading-relaxed text-fg-mute">
                  CCTV frames are processed entirely on-device: a fine-tuned YOLO head tracks
                  vehicles live and classifies each track into kinematic states (CRUISE, ACCEL,
                  IDLE, DECEL) at CPU-realtime rates. Per-class emission factors are fitted from
                  the tracked telemetry itself, then a dispatcher emits signal directives — LLM
                  decisions with a rules fallback — whose savings are estimated in deterministic
                  Python from the avoided idle-and-restart penalty. This console replays a
                  recorded session at <span className="num">junction_01</span> as a live feed:
                  every cumulative counter, the choke matrix and the directive log show values
                  as-of the playback clock ({Math.round(data.telemetry.spanSec)} s,{" "}
                  {data.telemetry.points.length} telemetry samples,{" "}
                  {data.perceptionStats?.n_unique_tracks ?? "—"} unique tracks); re-issued
                  directives arrive at even intervals across the window. Missing telemetry
                  renders as — and is never interpolated or invented.
                </p>
                <p className="num mt-3 text-[10px] text-fg-dim">
                  model: models/finetuned/best.pt · 5-class Indian-road taxonomy · CPU-realtime edge inference · telemetry-only uplink, no video, zero PII
                </p>
                <p className="num mt-1 text-[10px] text-fg-dim">
                  equivalences: ₹100/L petrol (config/emission_factors.yaml) · ≈2.3 kg CO₂/L ·
                  ≈20 kg CO₂/tree·yr — straight-line 24×7 extrapolation of the scenario delta
                </p>
              </div>
              <FactorsTable />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </footer>
  );
}

function FactorsTable() {
  return (
    <div>
      <h3 className="text-xs font-medium text-fg">Emission factors · measured on-site</h3>
      <table className="mt-2 w-full text-left">
        <thead>
          <tr className="border-b border-line text-[10px] uppercase tracking-wider text-fg-dim">
            <th className="py-1.5 pr-4 font-normal">Class</th>
            <th className="py-1.5 pr-4 text-right font-normal">Mean rate (g CO₂/s)</th>
            <th className="py-1.5 text-right font-normal">Fleet share</th>
          </tr>
        </thead>
        <tbody>
          {VEHICLE_CLASSES.map((cls) => {
            const rate = data.factors.perClassEmission_gs[cls];
            const share = data.factors.fleetShare[cls];
            return (
              <tr key={cls} className="border-b border-line-soft">
                <td className="py-1.5 pr-4 text-xs text-fg-mute">{cls.replace("_", " ")}</td>
                <td className="num py-1.5 pr-4 text-right text-xs text-fg">{fmtNum(rate, 2)}</td>
                <td className="num py-1.5 text-right text-xs text-fg-mute">
                  {fmtNum(share, 1)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="num mt-3 text-[10px] text-fg-dim">
        source: telemetry.parquet via pipeline · factors are per-vehicle means, not literature values
      </p>
    </div>
  );
}
