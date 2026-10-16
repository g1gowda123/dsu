"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import {
  data,
  overlay,
  overlayAt,
  STATE_COLORS,
  type KinematicState,
} from "@/lib/data";

const STATES: KinematicState[] = ["CRUISE", "ACCEL", "IDLE", "DECEL"];

function fmtT(sec: number): string {
  const s = Math.max(0, sec);
  const mm = Math.floor(s / 60);
  const ss = (s % 60).toFixed(1).padStart(4, "0");
  return `T+${String(mm).padStart(2, "0")}:${ss}`;
}

export function VideoPanel({
  t,
  onTime,
}: {
  t: number;
  onTime: (t: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onTimeRef = useRef(onTime);
  useEffect(() => {
    onTimeRef.current = onTime;
  }, [onTime]);
  const [playing, setPlaying] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const points = data.telemetry.points;
  const interval = data.telemetry.intervalSec;
  const span = data.telemetry.spanSec;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.play().catch(() => setPlaying(false));
      let raf = 0;
      const tick = () => {
        if (v.ended || v.currentTime >= v.duration - 0.05) {
          onTimeRef.current(Math.min(v.currentTime, span));
          setVideoEnded(true);
          setPlaying(false);
          return;
        }
        onTimeRef.current(Math.min(v.currentTime, span));
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }
    v.pause();
    if (!v.ended && Math.abs(v.currentTime - t) > 0.05) {
      v.currentTime = Math.min(t, v.duration || t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  useEffect(() => {
    const id = setTimeout(() => setPlaying(true), 900);
    return () => clearTimeout(id);
  }, []);

  const onScrub = useCallback(
    (val: number) => {
      setVideoEnded(false);
      const v = videoRef.current;
      if (v) {
        v.currentTime = Math.min(val, v.duration || val);
      }
      onTime(val);
    },
    [onTime],
  );

  const idx = Math.min(points.length - 1, Math.max(0, Math.floor(t / interval)));
  const point = points[idx];
  const liveT = Math.min(t, Math.min(data.telemetry.spanSec, overlay.maxT));

  /* Interpolate the 15 Hz per-frame tracks up to display rate so boxes stay in
     lockstep with the video instead of snapping every interval. */
  const { a, b, f } = overlayAt(liveT);
  const bIdx = b ? new Map(b.v.map((v) => [v[0], v])) : null;
  const boxes = a.v.map((v) => {
    const tb = bIdx?.get(v[0]);
    const x = tb ? v[3] + (tb[3] - v[3]) * f : v[3];
    const y = tb ? v[4] + (tb[4] - v[4]) * f : v[4];
    return {
      id: `TRK-${String(v[0]).padStart(3, "0")}`,
      cls: overlay.classes[v[1]],
      state: overlay.states[v[2]],
      x,
      y,
      w: v[5],
      h: v[6],
      speed: v[7],
    };
  });

  return (
    <section className="flex flex-col border border-line bg-panel">
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        <video
          ref={videoRef}
          src="/junction.mp4"
          className="absolute inset-0 h-full w-full object-cover opacity-90"
          muted
          playsInline
          preload="auto"
        />

        {/* vehicle overlay */}
        <div className="pointer-events-none absolute inset-0">
          {boxes.map((v) => (
            <div
              key={v.id}
              className="absolute"
              style={{
                left: `${v.x}%`,
                top: `${v.y}%`,
                width: `${v.w}%`,
                height: `${v.h}%`,
                outline: `1px solid ${STATE_COLORS[v.state] ?? "#e7eaec"}`,
                outlineOffset: "-1px",
              }}
            >
              <span
                className="num absolute -top-4 left-0 whitespace-nowrap text-[9px] leading-none"
                style={{ color: STATE_COLORS[v.state] ?? "#e7eaec" }}
              >
                <span className="bg-black/70 px-1 py-0.5">
                  {v.id} · {v.cls.replace("_", " ")} · {v.speed.toFixed(1)} km/h
                </span>
              </span>
            </div>
          ))}
        </div>

        {/* HUD */}
        <div className="num absolute left-3 top-3 flex flex-col gap-1 text-[11px] leading-tight text-fg">
          <div className="flex items-center gap-2">
            <span className="bg-black/70 px-1.5 py-0.5">
              CAM 01 · junction_01 · 1280×720
            </span>
          </div>
          <div className="flex items-baseline gap-1.5 bg-black/70 px-1.5 py-0.5">
            <span className="text-live">{fmtT(liveT)}</span>
            <span className="text-fg-mute">
              · {point ? point.emissionRate_gs.toFixed(1) : "—"} g CO₂/s · tmr{" "}
              {overlay.fps.toFixed(0)} Hz · boxes {boxes.length}
            </span>
          </div>
        </div>

        {/* kinematic legend */}
        <div className="absolute right-3 top-3 flex items-center gap-3 bg-black/70 px-2.5 py-1.5">
          {STATES.map((st) => (
            <span key={st} className="num flex items-center gap-1.5 text-[9px] text-fg-mute">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: STATE_COLORS[st] }}
                aria-hidden
              />
              {st}
            </span>
          ))}
        </div>
      </div>

      {/* scrub timeline */}
      <div className="flex items-center gap-3 border-t border-line px-3 py-2.5">
        <button
          onClick={() => {
            if (videoEnded) {
              const v = videoRef.current;
              if (v) v.currentTime = 0;
              setVideoEnded(false);
            }
            setPlaying((p) => !p);
          }}
          className="flex h-7 w-7 items-center justify-center border border-line text-fg-mute transition-colors hover:border-fg-mute hover:text-fg"
          aria-label={playing ? "Pause telemetry playback" : "Play telemetry playback"}
        >
          {playing ? (
            <Pause className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Play className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
        <span className="num shrink-0 text-[11px] text-fg-mute">
          {fmtT(liveT)} <span className="text-fg-dim">/ {fmtT(span)}</span>
        </span>
        <input
          type="range"
          min={0}
          max={span}
          step={0.1}
          value={liveT}
          onChange={(e) => onScrub(Number(e.target.value))}
          className="flex-1"
          aria-label="Scrub CCTV timeline"
        />
        <span className="num hidden shrink-0 text-[11px] text-fg-dim md:inline">
          {"threshold "}
          {point ? point.idleSpikeThreshold_gs.toFixed(0) : "—"} g/s
        </span>
      </div>
    </section>
  );
}
