#!/usr/bin/env python3
"""Run the perception pipeline: tracking + kinematics + telemetry generation.

Generates:
  - artifacts/telemetry.parquet
  - artifacts/telemetry_meta.json
  - artifacts/perception_stats.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any, Callable, Dict, List, Optional, Union
import cv2
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import yaml

# Ensure repo root is on sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from perception.kinematics import load_mean_lengths, update_track

TELEMETRY_SCHEMA = pa.schema([
    ("video_time_s", pa.float64()),
    ("track_id", pa.int32()),
    ("cls", pa.string()),
    ("cx_norm", pa.float32()),
    ("cy_norm", pa.float32()),
    ("bbox_w_px", pa.float32()),
    ("bbox_h_px", pa.float32()),
    ("speed_kmh", pa.float32()),
    ("state", pa.string()),
    ("track_age_frames", pa.int32()),
])


def load_app_config(config_path: Optional[Union[str, Path]] = None) -> Dict[str, Any]:
    c_path = Path(config_path) if config_path else REPO_ROOT / "config" / "app.yaml"
    with open(c_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def run_pipeline(
    input_source: Optional[Union[str, Path]] = None,
    output_dir: Optional[Union[str, Path]] = None,
    max_seconds: Optional[float] = None,
    config_path: Optional[Union[str, Path]] = None,
    detector_fn: Optional[Callable[[np.ndarray], List[Dict[str, Any]]]] = None,
) -> Optional[Dict[str, Any]]:
    """Execute perception pipeline.

    Accepts an injectable detector_fn (default: real Tracker) so tests run without weights.
    """
    cfg = load_app_config(config_path)

    # Resolve input video
    if input_source is None:
        input_source = cfg.get("video_source", "data/videos/junction.mp4")
    video_path = Path(input_source)
    if not video_path.is_absolute():
        video_path = REPO_ROOT / video_path

    if not video_path.exists():
        print("clip pending, track B")
        return None

    # Resolve output directory
    if output_dir is None:
        output_dir = cfg.get("artifacts_dir", "artifacts")
    out_dir = Path(output_dir)
    if not out_dir.is_absolute():
        out_dir = REPO_ROOT / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    # Initialize video capture
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"Error: Could not open video file at {video_path}")
        return None

    video_fps = cap.get(cv2.CAP_PROP_FPS)
    if video_fps <= 0 or np.isnan(video_fps):
        video_fps = 30.0

    img_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    img_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if img_w <= 0:
        img_w = int(cfg.get("imgsz", 640))
    if img_h <= 0:
        img_h = int(cfg.get("imgsz", 640))

    frame_skip = int(cfg.get("frame_skip", 2))
    # dt_s = frame_skip / video_fps from cv2.VideoCapture (NOT wall clock)
    dt_s = frame_skip / float(video_fps)

    min_track_age_frames = int(cfg.get("min_track_age_frames", 15))
    cfg["img_w"] = img_w
    cfg["img_h"] = img_h
    cfg["mean_length_m"] = load_mean_lengths()

    # Resolve tracker / detector
    if detector_fn is None:
        from perception.tracker import Tracker

        tracker = Tracker(cfg=cfg)
        detector_fn = tracker.track
        class_map = tracker.class_map
    else:
        # If injected detector has class_map attribute, use it; otherwise infer from active_classes
        class_map = getattr(
            detector_fn,
            "class_map",
            {i: name for i, name in enumerate(cfg.get("active_classes", []))},
        )

    track_states: Dict[int, Any] = {}
    records: List[Dict[str, Any]] = []

    frame_idx = 0
    sampled_count = 0

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        video_time_s = float(frame_idx) / float(video_fps)
        if max_seconds is not None and video_time_s > max_seconds:
            break

        if frame_idx % frame_skip == 0:
            detections = detector_fn(frame)
            for det in detections:
                track_id = int(det["track_id"])
                cls_name = str(det["cls"])
                cx_norm = float(det["cx_norm"])
                cy_norm = float(det["cy_norm"])
                bbox_w_px = float(det["bbox_w_px"])
                bbox_h_px = float(det.get("bbox_h_px", bbox_w_px))

                track_cfg = dict(cfg)
                track_cfg["cls"] = cls_name

                curr_state = track_states.get(track_id)
                new_state = update_track(
                    state=curr_state,
                    cx_norm=cx_norm,
                    cy_norm=cy_norm,
                    bbox_w_px=bbox_w_px,
                    dt_s=dt_s,
                    cfg=track_cfg,
                )
                track_states[track_id] = new_state

                # Include ALL tracks (even UNINIT/young — consumers gate)
                records.append({
                    "video_time_s": float(video_time_s),
                    "track_id": int(track_id),
                    "cls": str(cls_name),
                    "cx_norm": float(cx_norm),
                    "cy_norm": float(cy_norm),
                    "bbox_w_px": float(bbox_w_px),
                    "bbox_h_px": float(bbox_h_px),
                    "speed_kmh": float(new_state["speed_kmh"]),
                    "state": str(new_state["state"]),
                    "track_age_frames": int(new_state["track_age_frames"]),
                })
            sampled_count += 1
        frame_idx += 1

    cap.release()

    # 1. Telemetry Parquet
    parquet_path = out_dir / "telemetry.parquet"
    if records:
        df = pd.DataFrame(records)
    else:
        df = pd.DataFrame(columns=[
            "video_time_s", "track_id", "cls", "cx_norm", "cy_norm",
            "bbox_w_px", "bbox_h_px", "speed_kmh", "state", "track_age_frames"
        ])

    table = pa.Table.from_pandas(df, schema=TELEMETRY_SCHEMA, preserve_index=False)
    pq.write_table(table, parquet_path)

    # 2. Telemetry Metadata
    meta_path = out_dir / "telemetry_meta.json"
    telemetry_meta = {
        "video_fps": float(video_fps),
        "frame_skip": int(frame_skip),
        "dt_s": float(dt_s),
        "img_w": int(img_w),
        "img_h": int(img_h),
        "min_track_age_frames": int(min_track_age_frames),
        "class_map": {str(k): str(v) for k, v in class_map.items()},
    }
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(telemetry_meta, f, indent=2)

    # 3. Perception Stats
    stats_path = out_dir / "perception_stats.json"
    if len(df) > 0:
        n_unique_tracks = int(df["track_id"].nunique())
        track_lengths = df.groupby("track_id")["track_age_frames"].max()
        track_length_p50 = float(np.percentile(track_lengths, 50))
        track_length_p90 = float(np.percentile(track_lengths, 90))
        churn_count = int((track_lengths < min_track_age_frames).sum())
        churn_pct = float((churn_count / n_unique_tracks) * 100.0) if n_unique_tracks > 0 else 0.0

        class_histogram = {str(k): int(v) for k, v in df["cls"].value_counts().to_dict().items()}
        state_distribution = {str(k): int(v) for k, v in df["state"].value_counts().to_dict().items()}

        mean_speed_kmh_per_class = {}
        for cls_name, grp in df.groupby("cls"):
            mean_speed_kmh_per_class[str(cls_name)] = float(round(grp["speed_kmh"].mean(), 2))
    else:
        n_unique_tracks = 0
        track_length_p50 = 0.0
        track_length_p90 = 0.0
        churn_pct = 0.0
        class_histogram = {}
        state_distribution = {}
        mean_speed_kmh_per_class = {}

    for c in cfg.get("active_classes", []):
        class_histogram.setdefault(c, 0)
        mean_speed_kmh_per_class.setdefault(c, 0.0)

    for s in ["UNINIT", "IDLE", "ACCEL", "DECEL", "CRUISE"]:
        state_distribution.setdefault(s, 0)

    stats = {
        "n_unique_tracks": n_unique_tracks,
        "track_length_p50": track_length_p50,
        "track_length_p90": track_length_p90,
        "churn_pct": round(churn_pct, 2),
        "class_histogram": class_histogram,
        "state_distribution": state_distribution,
        "mean_speed_kmh_per_class": mean_speed_kmh_per_class,
    }

    with open(stats_path, "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2)

    print("==================================================")
    print("            PERCEPTION PIPELINE STATS             ")
    print("==================================================")
    print(f"Unique Tracks:          {n_unique_tracks}")
    print(f"Track Length (p50):     {track_length_p50:.1f} frames")
    print(f"Track Length (p90):     {track_length_p90:.1f} frames")
    print(f"Churn Percentage:       {churn_pct:.2f}%")
    print(f"Class Histogram:        {class_histogram}")
    print(f"State Distribution:     {state_distribution}")
    print(f"Mean Speed (km/h):      {mean_speed_kmh_per_class}")
    print(f"Artifacts Saved To:     {out_dir}")
    print("==================================================")

    return stats


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run perception tracking and telemetry pipeline.",
    )
    parser.add_argument(
        "--input",
        type=str,
        default=None,
        help="Path to input video file (default: from app.yaml)",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=None,
        help="Directory to save pipeline outputs and telemetry (default: artifacts)",
    )
    parser.add_argument(
        "--max-seconds",
        type=float,
        default=None,
        help="Maximum duration of video in seconds to process.",
    )
    parser.add_argument(
        "--config",
        type=str,
        default=None,
        help="Path to app.yaml configuration file.",
    )

    parser.add_argument(
        "--mock",
        action="store_true",
        help="Generate synthetic mock telemetry instead of running inference on video.",
    )

    args = parser.parse_args()
    if args.mock:
        from scripts.make_synthetic_telemetry import generate_synthetic_telemetry
        out_dir = Path(args.output_dir) if args.output_dir else REPO_ROOT / "artifacts"
        out_dir.mkdir(parents=True, exist_ok=True)
        duration = args.max_seconds or 120.0
        print(f"[Pipeline] --mock requested: generating {duration}s synthetic telemetry...")
        df_mock = generate_synthetic_telemetry(duration_s=duration, n_vehicles=30, seed=42)
        df_mock.to_parquet(out_dir / "telemetry.parquet", engine="pyarrow", index=False)
        print(f"[Pipeline] Saved synthetic telemetry to {out_dir / 'telemetry.parquet'}")
        return

    run_pipeline(
        input_source=args.input,
        output_dir=args.output_dir,
        max_seconds=args.max_seconds,
        config_path=args.config,
    )


if __name__ == "__main__":
    main()
