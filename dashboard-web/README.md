# CarbonTrack — Junction CO₂ Ops Console

Municipal traffic-carbon operations console: live CO₂ telemetry from CCTV vehicle
tracking, AI signal directives, and what-if policy simulation. Single-screen,
operator-grade dark UI built for the DSU DevHack demo.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind v4
- Framer Motion (feedback motion only, ≤300 ms ease-out)
- Geist Sans / Geist Mono (mono for all numbers, timestamps, IDs)
- No backend — all data flows through `src/lib/data.ts` from local mock
  artifacts (swap in a real API later without touching components)

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # vercel-ready, static prerender
```

## Data provenance

- `src/data/telemetry_series.json`, `events.jsonl`, `perception_stats.json`
  are regenerated from real on-device inference of `junction.mp4` via
  `scripts/run_pipeline.py` → `scripts/export_telemetry_series.py`
  (`twin/corridor.py` extracts events). Directives replay
  `artifacts/directives_mock.jsonl` (schema: `docs/contracts/directive.schema.json`).
- The console replays the recorded session as a live feed: every cumulative
  counter, the choke matrix and the directive log are **as-of the playback
  clock**; re-issued directives stream in at even intervals across the window.
- Missing telemetry renders as `—` — never invented.

## Privacy

No video leaves the processing node · zero PII · telemetry-only uplink.
The LLM dispatcher emits actions + rationale only; all carbon math is
deterministic Python (per-vehicle emission factors in `config/emission_factors.yaml`,
₹100/L petrol equivalence, currency INR).

## Structure

```
src/
  app/            layout (fonts, OG metadata), page, globals.css
  lib/data.ts     single data boundary: artifacts → replay model + prefix stats
  lib/sim.ts      what-if scenario engine + annualized equivalences
  components/     TopBar, HeadlineStrip, VideoPanel, ChokeHeatmap,
                  DirectiveFeed, WhatIfDrawer, MethodologyDrawer
  data/           frozen artifacts consumed at build time
```
