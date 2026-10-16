"use client";

import { sessionStatsAt, data } from "@/lib/data";
import { fmtNum } from "@/lib/data";
import { Num } from "@/components/Num";

const SESSION_FMT = (n: number) => `${n.toFixed(2)} kg`;
const AVOIDED_FMT = (n: number) => `${n.toFixed(1)} g`;

const zoneLabel = (zone: string | null) => {
  const m = /^z_r(\d)_c(\d)$/.exec(zone ?? "");
  return m ? `r${m[1]}·c${m[2]}` : "—";
};

function SmallStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub: string;
}) {
  return (
    <div className="flex min-w-[150px] flex-1 flex-col gap-1.5 py-4 pl-5 pr-6">
      <span className="whitespace-nowrap text-[10px] uppercase tracking-wider text-fg-dim">
        {label}
      </span>
      <span className="num whitespace-nowrap text-lg leading-none text-fg">
        {value}
      </span>
      <span className="num whitespace-nowrap text-[10px] text-fg-dim">{sub}</span>
    </div>
  );
}

export function HeadlineStrip({ t }: { t: number }) {
  const s = sessionStatsAt(t);
  const window = Math.round(data.telemetry.spanSec);
  const total = data.directives.length;

  return (
    <section className="flex flex-wrap items-stretch border border-line bg-panel">
      <div className="flex flex-col justify-center gap-2 px-6 py-5 pr-12">
        <span className="text-[10px] uppercase tracking-wider text-fg-dim">
          Cumulative CO₂ · as of {fmtT(t)}
        </span>
        <span className="num text-[44px] leading-none tracking-tight text-fg">
          <Num value={s.cumulativeCO2Kg} format={SESSION_FMT} />
        </span>
        <span className="num text-[10px] text-fg-dim">
          kg CO₂ · {window} s live window
        </span>
      </div>

      <div className="w-px bg-line" aria-hidden />

      <div className="flex flex-col justify-center gap-2 px-6 py-5 pr-12">
        <span className="text-[10px] uppercase tracking-wider text-fg-dim">
          Avoided CO₂ · directives
        </span>
        <span className="num text-[44px] leading-none tracking-tight text-live">
          <Num value={s.avoidedCO2G} format={AVOIDED_FMT} />
        </span>
        <span className="num text-[10px] text-fg-dim">
          g CO₂ estimated · {s.directivesIssued}/{total} directives streamed
        </span>
      </div>

      <div className="hidden w-px bg-line md:block" aria-hidden />

      <div className="flex min-w-0 flex-1 flex-wrap items-stretch divide-x divide-line">
        <SmallStat
          label="Vehicles tracked"
          value={fmtNum(s.vehiclesSeen, 0)}
          sub="unique tracks so far"
        />
        <SmallStat
          label="Idle share"
          value={s.idleSharePct !== null ? `${fmtNum(s.idleSharePct)}%` : "—"}
          sub="current frame block"
        />
        <SmallStat
          label="Stop events"
          value={fmtNum(s.stopEvents, 0)}
          sub="dwell ≥ 1.0 s"
        />
        <SmallStat
          label="Top choke zone"
          value={s.topChokeZone ? zoneLabel(s.topChokeZone.zone) : "—"}
          sub={
            s.topChokeZone
              ? `${s.topChokeZone.counts} crossings · ${s.topChokeZone.zone}`
              : "awaiting counts"
          }
        />
      </div>
    </section>
  );
}

function fmtT(sec: number): string {
  const s = Math.max(0, sec);
  const mm = Math.floor(s / 60);
  const ss = (s % 60).toFixed(1).padStart(4, "0");
  return `${String(mm).padStart(2, "0")}:${ss}`;
}
