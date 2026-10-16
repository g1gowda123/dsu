"use client";

import { motion } from "framer-motion";
import { ArrowRight, Bot, Radio } from "lucide-react";
import {
  data,
  replayT,
  fmtClock,
  type Directive,
  type DirectiveAction,
} from "@/lib/data";

function describeAction(a: DirectiveAction): string | null {
  const lane = a.lane ? ` ${a.lane}` : " —";
  const secs = a.seconds !== null && a.seconds !== undefined ? ` ${a.seconds}s` : " —";
  const cls = a.target_class ? ` · ${a.target_class.replace("_", " ")}` : "";
  switch (a.type) {
    case "extend_green":
      return `Extend green${lane}${secs}${cls}`;
    case "green_wave_priority":
      return `Green-wave priority${lane}${secs}${cls}`;
    case "heavy_vehicle_restriction":
      return `Restrict heavy vehicles${lane}${secs}${cls}`;
    case "no_action":
      return "Hold — no intervention";
    default:
      return null;
  }
}

function ActionText({ actions }: { actions: DirectiveAction[] }) {
  if (!actions || actions.length === 0) return <span className="text-fg-dim">—</span>;
  return (
    <span className="min-w-0 text-sm text-fg">
      {actions
        .map(describeAction)
        .filter(Boolean)
        .join(" + ")}
    </span>
  );
}

function Savings({ g }: { g: number | null }) {
  if (g === null || g === undefined) {
    return <span className="num whitespace-nowrap text-sm text-fg-dim">—</span>;
  }
  if (g === 0) {
    return <span className="num whitespace-nowrap text-sm text-fg-dim">0.0 g</span>;
  }
  return <span className="num whitespace-nowrap text-sm text-live">+{g.toFixed(1)} g</span>;
}

function ModeTag({ mode }: { mode: Directive["mode"] }) {
  if (!mode) {
    return <span className="num text-[10px] text-fg-dim">[—]</span>;
  }
  return mode === "llm" ? (
    <span className="num border border-line px-1 text-[10px] leading-4 text-fg">
      LLM
    </span>
  ) : (
    <span className="num border border-line-soft px-1 text-[10px] leading-4 text-fg-dim">
      RULES
    </span>
  );
}

function FeedItem({
  d,
  onSimulate,
}: {
  d: Directive;
  onSimulate: (d: Directive) => void;
}) {
  return (
    <motion.article
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="group px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <span className="num text-[11px] text-fg-mute">{fmtClock(d.timestamp)}</span>
        <ModeTag mode={d.mode} />
        <span className="num ml-auto truncate text-[10px] text-fg-dim opacity-0 transition-opacity group-hover:opacity-100">
          {d.directive_id ?? "—"}
        </span>
      </div>

      <div className="mt-1.5 flex items-baseline justify-between gap-3">
        <span className="min-w-0 flex-1">
          <ActionText actions={d.actions} />
        </span>
        <Savings g={d.estimated_co2_saved_g} />
      </div>

      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-fg-mute">
        {d.rationale ?? "—"}
      </p>

      <div className="mt-2 flex items-center gap-3">
        <span className="num text-[10px] text-fg-dim">
          cf {d.confidence !== null && d.confidence !== undefined ? d.confidence.toFixed(2).slice(1) : "—"}
        </span>
        <div className="h-[2px] flex-1 bg-line">
          <div
            className="h-full origin-left bg-fg-mute"
            style={{
              transform: `scaleX(${d.confidence ?? 0})`,
              transition: "transform 180ms ease-out",
            }}
          />
        </div>
        {d.actions?.some((a) => a.type !== "no_action") ? (
          <button
            onClick={() => onSimulate(d)}
            className="flex items-center gap-1 text-[11px] text-fg-dim transition-colors hover:text-fg"
          >
            Simulate <ArrowRight className="h-3 w-3" aria-hidden />
          </button>
        ) : (
          <span className="text-[11px] text-fg-dim/50 cursor-default select-none">
            Simulate
          </span>
        )}
      </div>
    </motion.article>
  );
}

export function DirectiveFeed({
  t,
  onSimulate,
}: {
  t: number;
  onSimulate: (d: Directive) => void;
}) {
  const all = data.directives;
  const visible = all.filter((d) => replayT(d) <= t);
  const pending = all.map((d) => replayT(d)).filter((rt) => rt > t);
  const nextInS = pending.length > 0 ? Math.min(...pending) - t : null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-baseline justify-between border-b border-line px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-xs font-medium tracking-wide text-fg">
          <Bot className="h-3.5 w-3.5 text-fg-mute" aria-hidden />
          Directive log
          <span className="text-fg-dim">· dispatcher LLM | rules</span>
        </h2>
        <span className="num text-[10px] text-fg-dim">
          {visible.length}/{all.length} streamed
        </span>
      </header>

      <div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        {visible.map((d) => (
          <FeedItem key={d.directive_id} d={d} onSimulate={onSimulate} />
        ))}
        {visible.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Radio className="h-4 w-4 text-fg-dim" aria-hidden />
            <p className="text-xs text-fg-dim">
              Monitoring corridor · directives appear as the dispatcher issues them
              <span className="num block pt-1 text-[10px] text-fg-dim/70">
                next in ~
                {nextInS !== null ? Math.max(1, Math.round(nextInS)) : "—"} s
              </span>
            </p>
          </div>
        )}
      </div>

      <footer className="space-y-1 border-t border-line px-4 py-2">
        <p className="num text-[10px] text-fg-dim">
          replayer streams re-issued directives at even intervals across the window
        </p>
        <p className="num text-[10px] text-fg-dim/80">
          compliance: carbon math deterministic in python · LLM emits actions only ·
          schema-validated out-of-bounds → rules_fallback
        </p>
      </footer>
    </div>
  );
}
