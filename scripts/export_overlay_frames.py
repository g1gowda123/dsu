#!/usr/bin/env python3
"""Export per-processed-frame tracked-vehicle overlays for the web console.

Reads artifacts/telemetry.parquet + config/emission_factors.yaml and writes
dashboard-web/src/data/telemetry_frames.json with one entry per processed
frame (video_fps / frame_skip Hz). The console interpolates between frames
up to the display refresh rate so ground boxes stay in sync with playback.

Uses the same gating and state/class normalization as export_telemetry_series.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import pandas as pd
import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from twin.emission_engine import compute_track_emissions

OUT_PATH = REPO_ROOT / "dashboard-web" / "src" / "data" / "telemetry_frames.json"

STATE_INDEX = {s: i for i, s in enumerate(["IDLE", "ACCEL", "CRUISE", "DECEL"])}
CLASS_INDEX = {
    c: i for i, c in enumerate(["car", "motorcycle", "auto_rickshaw", "bus", "truck"])
}


def normalize_state(st: Any, speed: float) -> str:
    s = str(st).upper()
    if s in STATE_INDEX:
        return s
    if speed < 2.0:
        return "IDLE"
    if speed > 35.0:
        return "CRUISE"
    return "ACCEL"


def normalize_class(c: Any) -> str:
    valid = {"car", "motorcycle", "auto_rickshaw", "bus", "truck"}
    c = str(c).lower().strip().replace(" ", "_").replace("-", "_")
    if c in valid:
        return c
    if "motor" in c or "bike" in c or "2w" in c:
        return "motorcycle"
    if "rickshaw" in c or "3w" in c or "auto" in c:
        return "auto_rickshaw"
    if "bus" in c:
        return "bus"
    if "truck" in c or "lorry" in c or "heavy" in c:
        return "truck"
    return "car"


def main() -> None:
    parquet = REPO_ROOT / "artifacts" / "telemetry.parquet"
    factors_path = REPO_ROOT / "config" / "emission_factors.yaml"
    meta_path = REPO_ROOT / "artifacts" / "telemetry_meta.json"

    factors = yaml.safe_load(factors_path.read_text(encoding="utf-8"))
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    img_w = float(meta.get("img_w", 1280))
    img_h = float(meta.get("img_h", 720))
    block_ratio = img_w / img_h  # width-% -> height-% conversion
    processed_fps = float(meta.get("video_fps", 30.0)) / float(
        meta.get("frame_skip", 2)
    )

    df = pd.read_parquet(parquet)
    em = compute_track_emissions(df, factors, min_age=3)

    min_t = float(em["video_time_s"].min())
    max_t = float(em["video_time_s"].max())

    frames: List[Dict[str, Any]] = []
    frame_times: List[float] = sorted(em["video_time_s"].unique().tolist())

    grouped = {float(k): g for k, g in em.groupby("video_time_s")}

    for t in frame_times:
        rows = grouped[t]
        v_list = []
        for _, r in rows.iterrows():
            cls = normalize_class(r["cls"])
            state = normalize_state(r["state"], float(r["speed_kmh"]))
            w_px = float(r.get("bbox_w_px", 60.0) if hasattr(r, "__getitem__") else 60.0)
            h_px = float(r.get("bbox_h_px", w_px))
            v_list.append(
                [
                    int(r["track_id"]),
                    CLASS_INDEX[cls],
                    STATE_INDEX[state],
                    round(float(r["cx_norm"]) * 100.0, 2),
                    round(float(r["cy_norm"]) * 100.0, 2),
                    round(max(0.8, min(24.0, w_px / img_w * 100.0)), 2),
                    round(max(0.8, min(18.0, h_px / img_h * 100.0)), 2),
                    round(float(r["speed_kmh"]), 1),
                    round(float(r["co2_rate_gps"]), 2),
                    lane_of(float(r["cx_norm"]), float(r["cy_norm"])),
                ]
            )
        frames.append({"t": round(t, 3), "v": v_list})

    out = {
        "fps": round(processed_fps, 3),
        "minT": round(min_t, 3),
        "maxT": round(max_t, 3),
        "states": list(STATE_INDEX.keys()),
        "classes": list(CLASS_INDEX.keys()),
        "frames": frames,
    }
    OUT_PATH.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    n = sum(len(f["v"]) for f in frames)
    print(
        f"wrote {OUT_PATH} · {len(frames)} frames · {n} track-boxes · "
        f"avg {n/len(frames):.1f}/frame · span {min_t:.1f}-{max_t:.1f}s"
    )


def lane_of(cx: float, cy: float) -> str:
    if cy < 0.4:
        return "N"
    if cy > 0.6:
        return "S"
    return "W" if cx < 0.5 else "E"


if __name__ == "__main__":
    main()
