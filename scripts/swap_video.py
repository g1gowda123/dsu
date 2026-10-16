#!/usr/bin/env python3
"""Utility script to swap out the active junction CCTV video asset at will.

Validates input file, normalizes video codec to web-compliant H.264 (+faststart),
updates data/videos/junction.mp4 and dashboard-web/public/junction.mp4, and optionally
re-renders perception telemetry overlay.

Usage:
    python scripts/swap_video.py /path/to/any_video.mp4
    python scripts/swap_video.py /path/to/any_video.mp4 --render-overlay
"""

from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import subprocess
import sys

REPO_ROOT = Path(__file__).resolve().parent.parent


def swap_video(
    source_video: str | Path,
    render_overlay_flag: bool = True,
    max_seconds: float | None = None,
) -> Path:
    src = Path(source_video).resolve()
    if not src.exists():
        raise FileNotFoundError(f"Source video file not found: {src}")

    target_data_dir = REPO_ROOT / "data" / "videos"
    target_data_dir.mkdir(parents=True, exist_ok=True)
    target_data = target_data_dir / "junction.mp4"

    target_web_dir = REPO_ROOT / "dashboard-web" / "public"
    target_web_dir.mkdir(parents=True, exist_ok=True)
    target_web = target_web_dir / "junction.mp4"

    target_assets_dir = REPO_ROOT / "assets_workspace"
    target_assets = target_assets_dir / "junction.mp4"

    print(f"[SwapVideo] Ingesting new video from: {src} ({src.stat().st_size / (1024*1024):.1f} MB)")

    # 1. Normalize video to H.264 720p yuv420p with faststart using ffmpeg if available
    ffmpeg_bin = shutil.which("ffmpeg")
    if ffmpeg_bin:
        temp_normalized = target_data_dir / "temp_norm.mp4"
        cmd = [
            ffmpeg_bin, "-y", "-i", str(src),
            "-vf", "scale=-2:720",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-crf", "23",
            "-an",
            str(temp_normalized),
        ]
        print("[SwapVideo] Transcoding to H.264 (720p, yuv420p, +faststart)...")
        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        if res.returncode == 0 and temp_normalized.exists():
            shutil.move(temp_normalized, target_data)
            print(f"[SwapVideo] Saved web-normalized video to {target_data}")
        else:
            print(f"[SwapVideo] FFmpeg warning, falling back to direct copy: {res.stderr.decode()[:200]}")
            shutil.copy2(src, target_data)
    else:
        print("[SwapVideo] FFmpeg not found, copying directly...")
        shutil.copy2(src, target_data)

    # 2. Mirror to dashboard-web and assets_workspace
    shutil.copy2(target_data, target_web)
    print(f"[SwapVideo] Synced to web public feed: {target_web}")
    if target_assets_dir.exists():
        shutil.copy2(target_data, target_assets)
        print(f"[SwapVideo] Synced to assets workspace: {target_assets}")

    # 3. Optionally re-render perception overlay
    if render_overlay_flag:
        from scripts.render_overlay import render_overlay
        overlay_out = REPO_ROOT / "artifacts" / "overlay.mp4"
        print("[SwapVideo] Re-rendering perception overlay...")
        try:
            render_overlay(
                video_path=target_data,
                telemetry_path=REPO_ROOT / "artifacts" / "telemetry.parquet",
                output_path=overlay_out,
                max_seconds=max_seconds,
            )
            print(f"[SwapVideo] Successfully refreshed {overlay_out} and web overlay!")
        except Exception as e:
            print(f"[SwapVideo] Notice: could not re-render overlay ({e}). Raw CCTV feed is ready.")

    print("\n✅ [SwapVideo] Swap complete! Refresh http://localhost:3000 to see the new CCTV feed.")
    return target_data


def main() -> None:
    parser = argparse.ArgumentParser(description="Swap active CCTV junction video file.")
    parser.add_argument("video", type=str, help="Path to new video file (MP4, MKV, AVI, etc.)")
    parser.add_argument(
        "--no-overlay",
        action="store_true",
        help="Skip re-rendering perception overlay (raw video only)",
    )
    parser.add_argument(
        "--max-seconds",
        type=float,
        default=None,
        help="Optional maximum seconds of video to render",
    )

    args = parser.parse_args()
    swap_video(
        source_video=args.video,
        render_overlay_flag=not args.no_overlay,
        max_seconds=args.max_seconds,
    )


if __name__ == "__main__":
    main()
