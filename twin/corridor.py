"""Corridor Aggregates and Zone Choke Point Analysis for Traffic Digital Twin.

Computes rolling time-window corridor aggregates, 4x4 spatial zone idle-time ranking,
event extraction (events.jsonl), and strict schema formatting for LLM dispatcher payloads.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
import pandas as pd


def compute_zone_rank(
    df: pd.DataFrame,
    dt_s: float = 0.08,
) -> List[Dict[str, Any]]:
    """Compute idle_vehicle_minutes per cell in a 4x4 spatial grid.

    Grid:
        r in {0, 1, 2, 3} on cy_norm
        c in {0, 1, 2, 3} on cx_norm
        Cell IDs: "z_r{r}_c{c}"

    Returns sorted list of dicts: [{"id": "z_r{r}_c{c}", "idle_vehicle_minutes": float}, ...]
    ranked descending by idle_vehicle_minutes.
    """
    grid = {}
    for r in range(4):
        for c in range(4):
            grid[f"z_r{r}_c{c}"] = 0.0

    idle_rows = df[df["state"] == "IDLE"]
    if not idle_rows.empty:
        # Determine cell for each idle row
        cx = np.clip(idle_rows["cx_norm"].values, 0.0, 0.9999)
        cy = np.clip(idle_rows["cy_norm"].values, 0.0, 0.9999)
        cols = (cx * 4).astype(int)
        rows = (cy * 4).astype(int)

        minutes_per_frame = dt_s / 60.0
        for r, c in zip(rows, cols):
            grid[f"z_r{r}_c{c}"] += minutes_per_frame

    ranked = [
        {"id": k, "idle_vehicle_minutes": float(round(v, 4))}
        for k, v in grid.items()
    ]
    ranked.sort(key=lambda x: x["idle_vehicle_minutes"], reverse=True)
    return ranked


def get_zone_id(cx_norm: float, cy_norm: float) -> str:
    """Determine 4x4 spatial zone id from normalized coordinates."""
    r = int(np.clip(float(cy_norm) * 4.0, 0.0, 3.0))
    c = int(np.clip(float(cx_norm) * 4.0, 0.0, 3.0))
    return f"z_r{r}_c{c}"


def extract_events(
    df: pd.DataFrame,
    min_age: int = 15,
    dt_s: float = 0.08,
    min_idle_s: float = 3.0,
) -> List[Dict[str, Any]]:
    """Derive telemetry events: vehicle_counted, stop_started, stop_ended.

    Schema:
        {"ts": float, "event": str, "track_id": int|null, "cls": str|null, "zone": str|null, "value": float|null}

    - vehicle_counted: Emitted on first gated frame per track.
    - stop_started / stop_ended: Emitted for contiguous IDLE segments >= min_idle_s.
    """
    events: List[Dict[str, Any]] = []
    min_frames = int(round(min_idle_s / dt_s))

    for track_id, group in df.groupby("track_id", sort=False):
        group_sorted = group.sort_values("video_time_s")
        gated_group = group_sorted[
            (group_sorted["track_age_frames"] >= min_age)
            & group_sorted["state"].isin(["IDLE", "ACCEL", "CRUISE", "DECEL"])
        ]

        if not gated_group.empty:
            first_row = gated_group.iloc[0]
            zone_id = get_zone_id(first_row["cx_norm"], first_row["cy_norm"])
            events.append({
                "ts": float(first_row["video_time_s"]),
                "event": "vehicle_counted",
                "track_id": int(track_id),
                "cls": str(first_row["cls"]),
                "zone": zone_id,
                "value": None,
            })

        # Identify contiguous IDLE segments
        states = group_sorted["state"].values
        times = group_sorted["video_time_s"].values
        classes = group_sorted["cls"].values
        cx_vals = group_sorted["cx_norm"].values
        cy_vals = group_sorted["cy_norm"].values
        is_idle = (states == "IDLE")

        if not np.any(is_idle):
            continue

        diff = np.diff(np.concatenate(([False], is_idle, [False])).astype(int))
        run_starts = np.where(diff == 1)[0]
        run_ends = np.where(diff == -1)[0]

        for start_idx, end_idx in zip(run_starts, run_ends):
            length = end_idx - start_idx
            if length >= min_frames:
                t_start = float(times[start_idx])
                # end_idx is exclusive, end time is last idle frame + dt_s
                t_end = float(times[end_idx - 1] + dt_s)
                duration_s = float(round(length * dt_s, 2))
                cls_name = str(classes[start_idx])
                zone_start = get_zone_id(cx_vals[start_idx], cy_vals[start_idx])
                zone_end = get_zone_id(cx_vals[end_idx - 1], cy_vals[end_idx - 1])

                events.append({
                    "ts": t_start,
                    "event": "stop_started",
                    "track_id": int(track_id),
                    "cls": cls_name,
                    "zone": zone_start,
                    "value": None,
                })
                events.append({
                    "ts": t_end,
                    "event": "stop_ended",
                    "track_id": int(track_id),
                    "cls": cls_name,
                    "zone": zone_end,
                    "value": duration_s,
                })

    events.sort(key=lambda e: (e["ts"], e["track_id"] if e["track_id"] is not None else 0))
    return events


def write_events_jsonl(events: List[Dict[str, Any]], filepath: Union[str, Path]) -> None:
    """Write events list to JSONL file."""
    path = Path(filepath)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for event in events:
            f.write(json.dumps(event) + "\n")


def aggregate(
    df: pd.DataFrame,
    window_s: float = 60.0,
    min_age: int = 15,
    dt_s: float = 0.08,
) -> List[Dict[str, Any]]:
    """Aggregate telemetry into rolling time windows.

    Per window dict:
        window_start_s: float
        co2_g_total: float
        idle_ratio: float (IDLE seconds / gated seconds)
        heavy_vehicle_density: float (bus+truck gated seconds share)
        n_counted_vehicles: int
        n_stop_events: int
        co2_g_per_min: float
        top_choke_zone: dict | None
        zone_rank: list[dict]
    """
    if df.empty:
        return []

    max_time = float(df["video_time_s"].max())
    n_windows = max(1, int(np.ceil(max_time / window_s)))

    # Compute dt per row if not present
    if "_dt_s" not in df.columns:
        dt_col = df.groupby("track_id", sort=False)["video_time_s"].diff().bfill().fillna(dt_s)
        df_work = df.copy()
        df_work["_dt_s"] = dt_col.clip(lower=0.001, upper=5.0)
    else:
        df_work = df.copy()

    # Pre-extract stop events across full dataset to assign to windows
    all_events = extract_events(df_work, min_age=min_age, dt_s=dt_s)
    stop_start_events = [e for e in all_events if e["event"] == "stop_started"]

    results: List[Dict[str, Any]] = []

    for w_idx in range(n_windows):
        w_start = float(w_idx * window_s)
        w_end = float(w_start + window_s)

        w_mask = (df_work["video_time_s"] >= w_start) & (df_work["video_time_s"] < w_end)
        w_df = df_work[w_mask]

        if w_df.empty:
            continue

        # Gated rows
        gated = w_df[
            (w_df["track_age_frames"] >= min_age)
            & w_df["state"].isin(["IDLE", "ACCEL", "CRUISE", "DECEL"])
        ]

        # CO2 accumulation
        if "co2_rate_gps" in gated.columns:
            co2_total = float(np.sum(gated["co2_rate_gps"].values * gated["_dt_s"].values))
        else:
            co2_total = 0.0

        # Gated seconds
        gated_seconds = float(np.sum(gated["_dt_s"].values)) if not gated.empty else 0.0

        # Idle ratio
        idle_gated = gated[gated["state"] == "IDLE"]
        idle_seconds = float(np.sum(idle_gated["_dt_s"].values)) if not idle_gated.empty else 0.0
        idle_ratio = (idle_seconds / gated_seconds) if gated_seconds > 0 else 0.0

        # Heavy vehicle density (bus + truck gated seconds share)
        heavy_gated = gated[gated["cls"].isin(["bus", "truck"])]
        heavy_seconds = float(np.sum(heavy_gated["_dt_s"].values)) if not heavy_gated.empty else 0.0
        heavy_density = (heavy_seconds / gated_seconds) if gated_seconds > 0 else 0.0

        # Counted vehicles in this window
        n_counted = int(gated["track_id"].nunique())

        # Stop events starting in this window
        w_stops = [e for e in stop_start_events if w_start <= e["ts"] < w_end]
        n_stops = len(w_stops)

        # co2_g_per_min normalized to 1 minute
        actual_window_duration_s = min(window_s, max(1.0, float(w_df["video_time_s"].max()) - w_start))
        co2_g_per_min = float(co2_total * (60.0 / actual_window_duration_s))

        # Zone ranks
        zone_ranks = compute_zone_rank(gated, dt_s=dt_s)
        top_zone = None
        if zone_ranks and zone_ranks[0]["idle_vehicle_minutes"] > 0:
            top_zone = zone_ranks[0]

        agg_dict = {
            "window_start_s": float(w_start),
            "co2_g_total": float(round(co2_total, 4)),
            "idle_ratio": float(round(idle_ratio, 4)),
            "heavy_vehicle_density": float(round(heavy_density, 4)),
            "n_counted_vehicles": int(n_counted),
            "n_stop_events": int(n_stops),
            "co2_g_per_min": float(round(co2_g_per_min, 4)),
            "top_choke_zone": top_zone,
            "zone_rank": zone_ranks,
        }
        results.append(agg_dict)

    return results


def to_dispatcher_payload(
    agg_row: Dict[str, Any],
    zone_rank: Optional[Union[List[Dict[str, Any]], Dict[str, Any], str]] = None,
    intersection_id: str = "junction_01",
) -> Dict[str, Any]:
    """Format corridor aggregate row into strict LLM dispatcher payload schema.

    EXACT schema consumed verbatim by Teammate D's dispatcher:
    {
        "intersection_id": str,
        "timestamp": ISO string,
        "window_s": float,
        "co2_g_total": float,
        "co2_g_per_min": float,
        "idle_ratio": float,
        "heavy_vehicle_density": float,
        "n_counted_vehicles": int,
        "n_stop_events": int,
        "top_choke_zone": {"id": str, "idle_vehicle_minutes": float} | null
    }
    """
    if isinstance(zone_rank, str):
        intersection_id = zone_rank
        zone_rank = None

    top_zone = None
    if isinstance(zone_rank, list) and zone_rank:
        if zone_rank[0].get("idle_vehicle_minutes", 0.0) > 0:
            top_zone = {
                "id": str(zone_rank[0]["id"]),
                "idle_vehicle_minutes": float(round(zone_rank[0]["idle_vehicle_minutes"], 4)),
            }
    elif isinstance(zone_rank, dict) and "id" in zone_rank:
        top_zone = {
            "id": str(zone_rank["id"]),
            "idle_vehicle_minutes": float(round(zone_rank.get("idle_vehicle_minutes", 0.0), 4)),
        }
    elif "top_choke_zone" in agg_row and agg_row["top_choke_zone"] is not None:
        top_zone = {
            "id": str(agg_row["top_choke_zone"]["id"]),
            "idle_vehicle_minutes": float(round(agg_row["top_choke_zone"]["idle_vehicle_minutes"], 4)),
        }

    payload = {
        "intersection_id": str(intersection_id),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "window_s": float(agg_row.get("window_s", 60.0)),
        "co2_g_total": float(agg_row.get("co2_g_total", 0.0)),
        "co2_g_per_min": float(agg_row.get("co2_g_per_min", 0.0)),
        "idle_ratio": float(agg_row.get("idle_ratio", 0.0)),
        "heavy_vehicle_density": float(agg_row.get("heavy_vehicle_density", 0.0)),
        "n_counted_vehicles": int(agg_row.get("n_counted_vehicles", 0)),
        "n_stop_events": int(agg_row.get("n_stop_events", 0)),
        "top_choke_zone": top_zone,
    }
    return payload
