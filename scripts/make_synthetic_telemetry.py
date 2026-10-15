#!/usr/bin/env python3
"""Synthetic telemetry generator for Eco-Kinetic Traffic Carbon Digital Twin.

Generates realistic Indian-intersection telemetry with deterministic output,
plausible kinematic transitions, and frozen schema matching downstream expectations.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import pandas as pd


def count_stop_events(df: pd.DataFrame, dt_s: float = 0.08, min_duration_s: float = 3.0) -> int:
    """Count contiguous IDLE segments per track with duration >= min_duration_s."""
    min_frames = int(round(min_duration_s / dt_s))
    stop_count = 0

    for _, group in df.groupby("track_id", sort=False):
        states = group["state"].values
        is_idle = (states == "IDLE")
        if not np.any(is_idle):
            continue

        # Find contiguous True runs
        diff = np.diff(np.concatenate(([False], is_idle, [False])).astype(int))
        run_starts = np.where(diff == 1)[0]
        run_ends = np.where(diff == -1)[0]
        run_lengths = run_ends - run_starts

        stop_count += int(np.sum(run_lengths >= min_frames))

    return stop_count


def generate_synthetic_telemetry(
    duration_s: float = 600.0,
    n_vehicles: int = 120,
    seed: int = 42,
    dt_s: float = 0.08,
) -> pd.DataFrame:
    """Generate deterministic synthetic vehicle telemetry adhering to frozen schema.

    Schema:
        video_time_s: float
        track_id: int
        cls: string (car|motorcycle|bus|truck)
        cx_norm: float [0-1]
        cy_norm: float [0-1]
        bbox_w_px: float
        speed_kmh: float
        state: string (IDLE|ACCEL|CRUISE|DECEL|UNINIT)
        track_age_frames: int
    """
    rng = np.random.default_rng(seed)

    # Class mix: ~55% motorcycle, 30% car, 8% bus, 7% truck
    n_moto = int(round(n_vehicles * 0.55))
    n_car = int(round(n_vehicles * 0.30))
    n_bus = max(2, int(round(n_vehicles * 0.08)))
    n_truck = n_vehicles - (n_moto + n_car + n_bus)

    classes = (
        ["motorcycle"] * n_moto
        + ["car"] * n_car
        + ["bus"] * n_bus
        + ["truck"] * n_truck
    )
    rng.shuffle(classes)

    speed_ranges = {
        "motorcycle": (30.0, 48.0),
        "car": (32.0, 50.0),
        "bus": (20.0, 35.0),
        "truck": (20.0, 32.0),
    }
    bbox_ranges = {
        "motorcycle": (45.0, 65.0),
        "car": (80.0, 110.0),
        "bus": (125.0, 160.0),
        "truck": (110.0, 145.0),
    }

    # 1-2 buses idle > 90s
    bus_indices = [i for i, c in enumerate(classes) if c == "bus"]
    long_idle_bus_indices = set(bus_indices[:2])

    stops = []
    for i in range(n_vehicles):
        if i in long_idle_bus_indices:
            stops.append(True)
        else:
            stops.append(bool(rng.random() < 0.82))

    approaches = rng.integers(0, 4, size=n_vehicles)
    entry_times = np.sort(rng.uniform(0.0, max(1.0, duration_s - 50.0), size=n_vehicles))
    entry_times = np.round(entry_times / dt_s) * dt_s

    records: List[Dict[str, Any]] = []

    for i in range(n_vehicles):
        track_id = i + 1
        cls = classes[i]
        appr = approaches[i]
        does_stop = stops[i]
        t_enter = entry_times[i]

        v_min, v_max = speed_ranges[cls]
        cruise_speed = float(rng.uniform(v_min, v_max))

        bw_min, bw_max = bbox_ranges[cls]
        bbox_w = float(round(rng.uniform(bw_min, bw_max), 1))

        lane_offset = float(rng.uniform(-0.02, 0.02))
        if appr == 0:  # N -> S
            start_pos = (0.47 + lane_offset, 0.02)
            end_pos = (0.47 + lane_offset, 0.98)
            stop_pos = (0.47 + lane_offset, 0.38)
        elif appr == 1:  # S -> N
            start_pos = (0.53 + lane_offset, 0.98)
            end_pos = (0.53 + lane_offset, 0.02)
            stop_pos = (0.53 + lane_offset, 0.62)
        elif appr == 2:  # W -> E
            start_pos = (0.02, 0.53 + lane_offset)
            end_pos = (0.98, 0.53 + lane_offset)
            stop_pos = (0.38, 0.53 + lane_offset)
        else:  # E -> W
            start_pos = (0.98, 0.47 + lane_offset)
            end_pos = (0.02, 0.47 + lane_offset)
            stop_pos = (0.62, 0.47 + lane_offset)

        if not does_stop:
            duration = float(rng.uniform(18.0, 26.0))
            n_frames = int(round(duration / dt_s))
            for f in range(n_frames):
                t = round(float(t_enter + f * dt_s), 4)
                if t > duration_s:
                    break
                track_age = f + 1
                state = "UNINIT" if track_age <= 5 else "CRUISE"
                speed = cruise_speed + float(rng.uniform(-1.0, 1.0))
                frac = f / max(1, n_frames - 1)
                cx = start_pos[0] + frac * (end_pos[0] - start_pos[0])
                cy = start_pos[1] + frac * (end_pos[1] - start_pos[1])
                records.append({
                    "video_time_s": float(t),
                    "track_id": int(track_id),
                    "cls": str(cls),
                    "cx_norm": float(np.clip(cx, 0.0, 1.0)),
                    "cy_norm": float(np.clip(cy, 0.0, 1.0)),
                    "bbox_w_px": float(bbox_w),
                    "speed_kmh": float(round(speed, 2)),
                    "state": str(state),
                    "track_age_frames": int(track_age),
                })
        else:
            t_cruise1 = float(rng.uniform(3.5, 6.0))
            n_c1 = int(round(t_cruise1 / dt_s))

            t_decel = float(rng.uniform(3.0, 4.5))
            n_dec = int(round(t_decel / dt_s))

            if i in long_idle_bus_indices:
                t_idle = float(rng.uniform(92.0, 105.0))
            else:
                t_idle = float(rng.uniform(12.0, 55.0))
            n_idl = int(round(t_idle / dt_s))

            t_accel = float(rng.uniform(3.5, 5.5))
            n_acc = int(round(t_accel / dt_s))

            t_cruise2 = float(rng.uniform(5.0, 8.0))
            n_c2 = int(round(t_cruise2 / dt_s))

            frame_count = 0

            # 1. Cruise 1
            for f in range(n_c1):
                t = round(float(t_enter + frame_count * dt_s), 4)
                frame_count += 1
                if t > duration_s:
                    break
                state = "UNINIT" if frame_count <= 5 else "CRUISE"
                speed = cruise_speed + float(rng.uniform(-0.8, 0.8))
                frac = (f / max(1, n_c1)) * 0.5
                cx = start_pos[0] + frac * (stop_pos[0] - start_pos[0])
                cy = start_pos[1] + frac * (stop_pos[1] - start_pos[1])
                records.append({
                    "video_time_s": float(t),
                    "track_id": int(track_id),
                    "cls": str(cls),
                    "cx_norm": float(np.clip(cx, 0.0, 1.0)),
                    "cy_norm": float(np.clip(cy, 0.0, 1.0)),
                    "bbox_w_px": float(bbox_w),
                    "speed_kmh": float(round(speed, 2)),
                    "state": str(state),
                    "track_age_frames": int(frame_count),
                })

            # 2. Decel
            for f in range(n_dec):
                t = round(float(t_enter + frame_count * dt_s), 4)
                frame_count += 1
                if t > duration_s:
                    break
                dec_frac = f / max(1, n_dec)
                speed = max(0.0, cruise_speed * (1.0 - dec_frac))
                frac = 0.5 + 0.5 * dec_frac
                cx = start_pos[0] + frac * (stop_pos[0] - start_pos[0])
                cy = start_pos[1] + frac * (stop_pos[1] - start_pos[1])
                records.append({
                    "video_time_s": float(t),
                    "track_id": int(track_id),
                    "cls": str(cls),
                    "cx_norm": float(np.clip(cx, 0.0, 1.0)),
                    "cy_norm": float(np.clip(cy, 0.0, 1.0)),
                    "bbox_w_px": float(bbox_w),
                    "speed_kmh": float(round(speed, 2)),
                    "state": "DECEL",
                    "track_age_frames": int(frame_count),
                })

            # 3. Idle (speed < 2 km/h strictly for duration >= 3s)
            for _ in range(n_idl):
                t = round(float(t_enter + frame_count * dt_s), 4)
                frame_count += 1
                if t > duration_s:
                    break
                speed = 0.0
                cx = stop_pos[0]
                cy = stop_pos[1]
                records.append({
                    "video_time_s": float(t),
                    "track_id": int(track_id),
                    "cls": str(cls),
                    "cx_norm": float(np.clip(cx, 0.0, 1.0)),
                    "cy_norm": float(np.clip(cy, 0.0, 1.0)),
                    "bbox_w_px": float(bbox_w),
                    "speed_kmh": 0.0,
                    "state": "IDLE",
                    "track_age_frames": int(frame_count),
                })

            # 4. Accel
            for f in range(n_acc):
                t = round(float(t_enter + frame_count * dt_s), 4)
                frame_count += 1
                if t > duration_s:
                    break
                acc_frac = f / max(1, n_acc)
                speed = cruise_speed * acc_frac
                frac = acc_frac * 0.4
                cx = stop_pos[0] + frac * (end_pos[0] - stop_pos[0])
                cy = stop_pos[1] + frac * (end_pos[1] - stop_pos[1])
                records.append({
                    "video_time_s": float(t),
                    "track_id": int(track_id),
                    "cls": str(cls),
                    "cx_norm": float(np.clip(cx, 0.0, 1.0)),
                    "cy_norm": float(np.clip(cy, 0.0, 1.0)),
                    "bbox_w_px": float(bbox_w),
                    "speed_kmh": float(round(speed, 2)),
                    "state": "ACCEL",
                    "track_age_frames": int(frame_count),
                })

            # 5. Cruise 2
            for f in range(n_c2):
                t = round(float(t_enter + frame_count * dt_s), 4)
                frame_count += 1
                if t > duration_s:
                    break
                c2_frac = f / max(1, n_c2)
                speed = cruise_speed + float(rng.uniform(-0.8, 0.8))
                frac = 0.4 + 0.6 * c2_frac
                cx = stop_pos[0] + frac * (end_pos[0] - stop_pos[0])
                cy = stop_pos[1] + frac * (end_pos[1] - stop_pos[1])
                records.append({
                    "video_time_s": float(t),
                    "track_id": int(track_id),
                    "cls": str(cls),
                    "cx_norm": float(np.clip(cx, 0.0, 1.0)),
                    "cy_norm": float(np.clip(cy, 0.0, 1.0)),
                    "bbox_w_px": float(bbox_w),
                    "speed_kmh": float(round(speed, 2)),
                    "state": "CRUISE",
                    "track_age_frames": int(frame_count),
                })

    df = pd.DataFrame(records)
    # Ensure types
    df = df.astype({
        "video_time_s": "float64",
        "track_id": "int64",
        "cls": "object",
        "cx_norm": "float64",
        "cy_norm": "float64",
        "bbox_w_px": "float64",
        "speed_kmh": "float64",
        "state": "object",
        "track_age_frames": "int64",
    })
    df.sort_values(by=["video_time_s", "track_id"], inplace=True)
    df.reset_index(drop=True, inplace=True)
    return df


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate deterministic synthetic telemetry parquet."
    )
    parser.add_argument(
        "--duration-s",
        type=float,
        default=600.0,
        help="Duration of simulation in seconds (default: 600.0)",
    )
    parser.add_argument(
        "--n-vehicles",
        type=int,
        default=120,
        help="Number of vehicles to generate (default: 120)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for determinism (default: 42)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default="artifacts/telemetry_synthetic.parquet",
        help="Path for output parquet file",
    )
    parser.add_argument(
        "--payload-output",
        type=str,
        default="artifacts/corridor_payload_synthetic.json",
        help="Path for corridor payload JSON output",
    )

    args = parser.parse_args()

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    df = generate_synthetic_telemetry(
        duration_s=args.duration_s,
        n_vehicles=args.n_vehicles,
        seed=args.seed,
    )

    df.to_parquet(out_path, engine="pyarrow", index=False)

    # Compute key stats
    total_vehicles = int(df["track_id"].nunique())
    stop_events = count_stop_events(df, dt_s=0.08, min_duration_s=3.0)

    # Ledger gate: track_age_frames >= 15
    gated = df[df["track_age_frames"] >= 15]
    idle_gated_count = int(np.sum(gated["state"] == "IDLE"))
    gated_total_count = len(gated)
    idle_ratio = idle_gated_count / max(1, gated_total_count)

    print("=== Synthetic Telemetry Generated ===")
    print(f"Output File:       {out_path}")
    print(f"Total Rows:        {len(df)}")
    print(f"Unique Vehicles:   {total_vehicles}")
    print(f"Stop Events:       {stop_events}")
    print(f"Idle Ratio:        {idle_ratio:.4f}")
    bus_ids = df[df["cls"] == "bus"]["track_id"].unique()
    long_idle_buses = sum(
        1 for b in bus_ids
        if (df[(df["track_id"] == b) & (df["state"] == "IDLE")].shape[0] * 0.08) > 90.0
    )
    print(f"Long Idle Buses (>90s): {long_idle_buses}")

    # Check if corridor module exists to emit corridor payload
    try:
        from twin.corridor import aggregate, to_dispatcher_payload
        from twin.emission_engine import compute_track_emissions
        import yaml

        # Load factors
        config_path = Path("config/emission_factors.yaml")
        if config_path.exists():
            with open(config_path, "r", encoding="utf-8") as f:
                factors = yaml.safe_load(f)
            df_emitted = compute_track_emissions(df, factors, min_age=15)
            aggs, zone_ranks = aggregate(df_emitted, window_s=60.0)
            if aggs:
                payload = to_dispatcher_payload(
                    aggs[0],
                    zone_ranks[0] if zone_ranks else [],
                    intersection_id="junction_01",
                )
                payload_path = Path(args.payload_output)
                payload_path.parent.mkdir(parents=True, exist_ok=True)
                with open(payload_path, "w", encoding="utf-8") as f:
                    json.dump(payload, f, indent=2)
                print(f"Corridor Payload:  {payload_path}")
    except (ImportError, AttributeError, Exception):
        # Corridor module not yet built; will be generated once corridor is implemented
        pass


if __name__ == "__main__":
    main()
