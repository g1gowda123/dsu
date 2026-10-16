"use client";

import { heatmapAt, data } from "@/lib/data";
import { fmtNum } from "@/lib/data";

function intensity(count: number, max: number): number {
  if (count === 0) return 0;
  return 0.12 + 0.78 * Math.sqrt(count / max);
}

export function ChokeHeatmap({ t }: { t: number }) {
  const { grid, maxCounts } = heatmapAt(t);
  const top = grid
    .flat()
    .reduce((a, b) => (b.counts > a.counts ? b : a), grid[0][0]);

  return (
    <section className="flex flex-col border border-line bg-panel">
      <header className="flex items-baseline justify-between border-b border-line px-4 py-2.5">
        <h2 className="text-xs font-medium tracking-wide text-fg">
          Choke matrix <span className="text-fg-dim">· stopline occupancy grid</span>
        </h2>
        <span className="num text-[10px] text-fg-dim">
          counts as of T+{fmtNum(t, 0)}s · {data.telemetry.spanSec.toFixed(0)} s window
        </span>
      </header>

      <div className="px-4 py-4">
        <div className="flex gap-2">
          <div className="flex w-4 shrink-0 flex-col justify-around">
            {grid.map((_, r) => (
              <span key={r} className="num text-[9px] text-fg-dim">
                {r}
              </span>
            ))}
          </div>
          <div className="grid flex-1 grid-cols-4 gap-1">
            {grid.flat().map((cell) => {
              const a = intensity(cell.counts, maxCounts);
              const isTop = cell.zone === top.zone && cell.counts > 0;
              return (
                <div
                  key={cell.zone}
                  className="group relative aspect-[4/2] border border-line-soft"
                  style={{
                    background: `rgba(231, 234, 236, ${a.toFixed(3)})`,
                  }}
                  tabIndex={0}
                >
                  <span className="num absolute bottom-1 left-1.5 text-[9px] leading-none text-fg-dim group-hover:text-fg">
                    {cell.counts > 0 ? cell.counts : ""}
                  </span>
                  {isTop && (
                    <span className="num absolute right-1.5 top-1 text-[10px] leading-none text-fg">
                      ◤
                    </span>
                  )}
                  <div className="pointer-events-none absolute bottom-full left-0 z-10 hidden w-48 border border-line bg-bg pb-2 group-hover:block group-focus-within:block">
                    <div className="border-b border-line bg-panel px-2 py-1.5">
                      <span className="num text-[10px] text-fg">{cell.zone}</span>
                    </div>
                    <div className="px-2 pt-1.5">
                      <div className="num flex justify-between text-[10px] text-fg-mute">
                        <span>crossings</span>
                        <span className="text-fg">{cell.counts || "—"}</span>
                      </div>
                      {Object.entries(cell.byClass)
                        .filter(([, n]) => (n ?? 0) > 0)
                        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                        .map(([cls, n]) => (
                          <div
                            key={cls}
                            className="num flex justify-between text-[10px] text-fg-dim"
                          >
                            <span>{cls.replace("_", " ")}</span>
                            <span>{fmtNum(n ?? 0, 0)}</span>
                          </div>
                        ))}
                      {isTop && (
                        <div className="num mt-1.5 border-t border-line pt-1.5 text-[10px] text-live">
                          top choke zone
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="num flex justify-between pt-2 pl-6 text-[9px] text-fg-dim">
          {grid[0].map((c) => (
            <span key={c.zone} className="w-1/4">
              c{c.zone.match(/c(\d)/)?.[1]}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
