"use client";

import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { data } from "@/lib/data";

function UtcClock() {
  const [now, setNow] = useState<string>(null as unknown as string);
  useEffect(() => {
    const tick = () => setNow(new Date().toISOString().slice(11, 19) + " UTC");
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="num text-xs text-fg-mute" suppressHydrationWarning>
      {now ?? "—"}
    </span>
  );
}

export function TopBar({ onOpenWhatIf }: { onOpenWhatIf: () => void }) {
  const junction = data.summary.junctionId ?? "junction_—";
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg">
      <div className="mx-auto flex h-12 w-full max-w-[1600px] items-center gap-4 px-6">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 bg-fg" aria-hidden />
          <span className="text-sm font-semibold tracking-tight text-fg">
            CarbonTrack
          </span>
        </div>

        <span className="h-4 w-px bg-line" aria-hidden />

        <span className="num text-xs text-fg-mute">{junction}</span>
        <span className="num hidden text-xs text-fg-dim md:inline">
          · 4-approach corridor · edge CCTV
        </span>

        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-1.5 border border-line px-2 py-1">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-live" aria-hidden />
            <span className="num text-[10px] tracking-wider text-fg">LIVE</span>
          </div>
          <span className="border border-line px-2 py-1 text-[10px] tracking-wider text-fg-dim">
            SIM
          </span>
          <span className="hidden h-4 w-px bg-line sm:block" aria-hidden />
          <UtcClock />
          <button
            onClick={onOpenWhatIf}
            className="flex items-center gap-2 border border-line px-3 py-1.5 text-xs text-fg-mute transition-colors hover:border-fg-mute hover:text-fg"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
            What-If
          </button>
        </div>
      </div>
    </header>
  );
}
