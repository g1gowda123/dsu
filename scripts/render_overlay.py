#!/usr/bin/env python3
"""Render tracked bounding boxes and kinematic states onto junction video or synthetic canvas.

Generates: artifacts/overlay.mp4
Usage:
    python scripts/render_overlay.py --video data/videos/junction.mp4 --telemetry artifacts/telemetry.parquet --output artifacts/overlay.mp4
"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys
from typing import Dict, List, Optional, Tuple
import cv2
import numpy as np
import pandas as pd
import pyarrow.parquet as pq

# Ensure repo root is on sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# Color palette by state (BGR)
STATE_COLORS: Dict[str, Tuple[int, int, int]] = {
    "CRUISE": (46, 204, 113),   # Green
    "ACCEL": (0, 165, 255),    # Amber
    "IDLE": (40, 40, 235),     # Red
    "DECEL": (235, 120, 40),   # Blue
    "UNINIT": (128, 128, 128),  # Gray
}


def draw_synthetic_background(img_w: int = 1280, img_h: int = 720) -> np.ndarray:
    """Create a dark asphalt intersection canvas with road lane markings."""
    frame = np.full((img_h, img_w, 3), 32, dtype=np.uint8)

    # Road intersection cross
    road_color = (45, 45, 48)
    # Vertical road
    v_w = int(img_w * 0.28)
    v_x1 = (img_w - v_w) // 2
    v_x2 = v_x1 + v_w
    cv2.rectangle(frame, (v_x1, 0), (v_x2, img_h), road_color, -1)

    # Horizontal road
    h_h = int(img_h * 0.36)
    h_y1 = (img_h - h_h) // 2
    h_y2 = h_y1 + h_h
    cv2.rectangle(frame, (0, h_y1), (img_w, h_y2), road_color, -1)

    # Lane dividing lines (dashed yellow)
    yellow = (0, 215, 255)
    dash_len = 25
    gap_len = 20

    # Vertical center lane divider
    v_center = img_w // 2
    for y in range(0, img_h, dash_len + gap_len):
        if h_y1 <= y <= h_y2:
            continue  # leave intersection open
        cv2.line(frame, (v_center, y), (v_center, min(img_h, y + dash_len)), yellow, 2)

    # Horizontal center lane divider
    h_center = img_h // 2
    for x in range(0, img_w, dash_len + gap_len):
        if v_x1 <= x <= v_x2:
            continue
        cv2.line(frame, (x, h_center), (min(img_w, x + dash_len), h_center), yellow, 2)

    # Outer road borders (solid white)
    white = (200, 200, 200)
    cv2.line(frame, (v_x1, 0), (v_x1, img_h), white, 2)
    cv2.line(frame, (v_x2, 0), (v_x2, img_h), white, 2)
    cv2.line(frame, (0, h_y1), (img_w, h_y1), white, 2)
    cv2.line(frame, (0, h_y2), (img_w, h_y2), white, 2)

    return frame


def render_overlay(
    video_path: Optional[Union[str, Path]] = None,
    telemetry_path: Optional[Union[str, Path]] = None,
    output_path: Optional[Union[str, Path]] = None,
    max_seconds: Optional[float] = None,
) -> Path:
    """Render perception telemetry overlays onto video or synthetic canvas."""
    if output_path is None:
        output_path = REPO_ROOT / "artifacts" / "overlay.mp4"
    out_file = Path(output_path)
    if not out_file.is_absolute():
        out_file = REPO_ROOT / out_file
    out_file.parent.mkdir(parents=True, exist_ok=True)

    # 1. Load Telemetry
    if telemetry_path is None:
        telemetry_path = REPO_ROOT / "artifacts" / "telemetry.parquet"
    tel_path = Path(telemetry_path)
    if not tel_path.is_absolute():
        tel_path = REPO_ROOT / tel_path

    if not tel_path.exists():
        fixture_cand = REPO_ROOT / "tests" / "fixtures" / "telemetry_fixture.parquet"
        if fixture_cand.exists():
            print(f"[RenderOverlay] Telemetry {tel_path} not found. Falling back to fixture: {fixture_cand}")
            tel_path = fixture_cand
        else:
            raise FileNotFoundError(f"Telemetry file not found at {tel_path} and fixture absent.")

    table = pq.read_table(tel_path)
    df = table.to_pandas()
    if df.empty:
        raise ValueError("Telemetry dataset is empty.")

    # Sort telemetry chronologically
    df.sort_values(by="video_time_s", inplace=True)
    min_time = float(df["video_time_s"].min())
    max_time = float(df["video_time_s"].max())
    if max_seconds is not None:
        max_time = min(max_time, min_time + float(max_seconds))

    # 2. Setup Video Source or Synthetic Canvas
    if video_path is None:
        video_path = REPO_ROOT / "data" / "videos" / "junction.mp4"
    vid_path = Path(video_path)
    if not vid_path.is_absolute():
        vid_path = REPO_ROOT / vid_path

    cap = None
    use_synthetic = True
    if vid_path.exists():
        cap = cv2.VideoCapture(str(vid_path))
        if cap.isOpened():
            use_synthetic = False
            fps = cap.get(cv2.CAP_PROP_FPS)
            if fps <= 0 or np.isnan(fps):
                fps = 30.0
            img_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            img_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            if img_w <= 0 or img_h <= 0:
                img_w, img_h = 1280, 720
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            print(f"[RenderOverlay] Using video source: {vid_path} ({img_w}x{img_h} @ {fps:.1f} fps)")

    if use_synthetic:
        img_w, img_h = 1280, 720
        fps = 25.0
        duration_to_render = max(5.0, max_time - min_time)
        total_frames = int(round(duration_to_render * fps)) + 1
        base_canvas = draw_synthetic_background(img_w, img_h)
        print(f"[RenderOverlay] Video absent. Rendering on synthetic canvas ({img_w}x{img_h} @ {fps:.1f} fps, {duration_to_render:.1f}s)")

    # 3. Setup VideoWriter
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(out_file), fourcc, fps, (img_w, img_h))
    if not writer.isOpened():
        raise RuntimeError(f"Could not open VideoWriter for {out_file}")

    # Index telemetry by time window for efficient frame-by-frame lookup
    # Tolerance window ~ 1.5 frame interval
    time_tol = 1.0 / fps

    print(f"[RenderOverlay] Rendering overlay to {out_file}...")
    frame_idx = 0
    next_report_pct = 10

    while True:
        if max_seconds is not None and (frame_idx / fps) > max_seconds:
            break

        if use_synthetic:
            if frame_idx >= total_frames:
                break
            frame = base_canvas.copy()
            video_time_s = min_time + (frame_idx / fps)
        else:
            ret, frame = cap.read()
            if not ret:
                break
            video_time_s = frame_idx / fps

        # Find detections matching current video_time_s
        # Match telemetry rows within time_tol
        t_mask = (df["video_time_s"] >= (video_time_s - time_tol)) & (df["video_time_s"] <= (video_time_s + time_tol))
        current_dets = df[t_mask]

        # Draw detections
        for _, row in current_dets.iterrows():
            # Rule: Skip tracks with track_age_frames < 15 in the render
            age = int(row["track_age_frames"])
            if age < 15:
                continue

            track_id = int(row["track_id"])
            cls_name = str(row["cls"])
            state = str(row["state"])
            speed_kmh = float(row["speed_kmh"])
            cx_norm = float(row["cx_norm"])
            cy_norm = float(row["cy_norm"])
            bbox_w_px = float(row["bbox_w_px"])

            # Box dimensions: height = width * 2.5
            box_w = max(10.0, bbox_w_px)
            box_h = box_w * 2.5

            cx_px = cx_norm * img_w
            cy_px = cy_norm * img_h

            x1 = int(np.clip(cx_px - box_w / 2.0, 0, img_w - 1))
            y1 = int(np.clip(cy_px - box_h / 2.0, 0, img_h - 1))
            x2 = int(np.clip(cx_px + box_w / 2.0, 0, img_w - 1))
            y2 = int(np.clip(cy_px + box_h / 2.0, 0, img_h - 1))

            color = STATE_COLORS.get(state, (180, 180, 180))

            # Draw bounding box
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

            # Label banner
            # Label format: "ID #{track_id} {cls} {speed:.0f}km/h"
            label = f"ID #{track_id} {cls_name} {speed_kmh:.0f}km/h"
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 0.42
            font_thickness = 1
            (text_w, text_h), baseline = cv2.getTextSize(label, font, font_scale, font_thickness)

            label_y1 = max(0, y1 - text_h - 6)
            label_y2 = y1
            cv2.rectangle(frame, (x1, label_y1), (x1 + text_w + 6, label_y2), color, -1)
            cv2.putText(
                frame,
                label,
                (x1 + 3, label_y2 - 3),
                font,
                font_scale,
                (255, 255, 255),
                font_thickness,
                cv2.LINE_AA,
            )

        # Header HUD
        hud_bg_color = (20, 20, 22)
        cv2.rectangle(frame, (10, 10), (450, 75), hud_bg_color, -1)
        cv2.rectangle(frame, (10, 10), (450, 75), (80, 80, 85), 1)
        cv2.putText(
            frame,
            f"ECO-KINETIC TWIN | TIME: {video_time_s:05.1f}s",
            (20, 32),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )

        # Legend dots
        legend_items = [("CRUISE", (46, 204, 113)), ("ACCEL", (0, 165, 255)), ("IDLE", (40, 40, 235)), ("DECEL", (235, 120, 40))]
        lx = 20
        for name, col in legend_items:
            cv2.circle(frame, (lx + 5, 54), 4, col, -1)
            cv2.putText(frame, name, (lx + 13, 58), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (200, 200, 200), 1, cv2.LINE_AA)
            lx += 95

        writer.write(frame)
        frame_idx += 1

        # Print progress every 10%
        pct = int((frame_idx / max(1, total_frames)) * 100)
        if pct >= next_report_pct:
            print(f"[RenderOverlay] Progress: {pct}% ({frame_idx}/{total_frames} frames)")
            next_report_pct = (pct // 10 + 1) * 10

    writer.release()
    if cap is not None:
        cap.release()

    # Transcode to web-compatible H.264 (yuv420p, faststart)
    import shutil
    import subprocess
    if shutil.which("ffmpeg"):
        temp_h264 = out_file.with_name(f"{out_file.stem}_h264{out_file.suffix}")
        cmd = [
            "ffmpeg", "-y", "-i", str(out_file),
            "-vcodec", "libx264", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-crf", "23",
            str(temp_h264),
        ]
        ret = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if ret.returncode == 0 and temp_h264.exists():
            temp_h264.replace(out_file)
            print(f"[RenderOverlay] H.264 web transcode completed for {out_file}")

    # Copy to dashboard-web/public/overlay.mp4 if present
    web_public = REPO_ROOT / "dashboard-web" / "public"
    if web_public.exists():
        shutil.copy2(out_file, web_public / "overlay.mp4")

    print(f"[RenderOverlay] Complete. Output saved: {out_file} ({frame_idx} frames)")
    return out_file


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Render kinematic tracking overlay onto video.",
    )
    parser.add_argument(
        "--video",
        type=str,
        default="data/videos/junction.mp4",
        help="Path to input video file (default: data/videos/junction.mp4)",
    )
    parser.add_argument(
        "--telemetry",
        type=str,
        default="artifacts/telemetry.parquet",
        help="Path to telemetry parquet (default: artifacts/telemetry.parquet)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default="artifacts/overlay.mp4",
        help="Path for output overlay mp4 (default: artifacts/overlay.mp4)",
    )
    parser.add_argument(
        "--max-seconds",
        type=float,
        default=None,
        help="Optional maximum duration in seconds to render.",
    )

    args = parser.parse_args()
    render_overlay(
        video_path=args.video,
        telemetry_path=args.telemetry,
        output_path=args.output,
        max_seconds=args.max_seconds,
    )


if __name__ == "__main__":
    main()
