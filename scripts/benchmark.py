#!/usr/bin/env python3
"""Edge performance benchmark script for Eco-Kinetic Traffic Carbon Digital Twin.

Measures:
  - Model size (MB)
  - PyTorch CPU inference latency and FPS (100 frames)
  - Peak RAM footprint via tracemalloc
  - Telemetry byte-rate (bytes / video minute)
  - ONNX CPU export and runtime FPS
  - Optional INT8 quantization speed and size

Writes output to: artifacts/perf_report.json
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import time
import tracemalloc
from typing import Any, Dict, Optional
import cv2
import numpy as np
import pyarrow.parquet as pq

# Ensure repo root is on sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def run_benchmark(
    model_path: Optional[str] = None,
    output_path: Optional[str] = None,
    telemetry_path: Optional[str] = None,
    n_frames: int = 100,
) -> Dict[str, Any]:
    if model_path is None:
        model_path = str(REPO_ROOT / "models" / "finetuned" / "best.pt")
    if output_path is None:
        output_path = str(REPO_ROOT / "artifacts" / "perf_report.json")
    if telemetry_path is None:
        telemetry_path = str(REPO_ROOT / "artifacts" / "telemetry.parquet")

    pt_file = Path(model_path)
    if not pt_file.exists():
        raise FileNotFoundError(f"Model file not found at {pt_file}")

    out_file = Path(output_path)
    out_file.parent.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("      ECO-KINETIC EDGE CPU BENCHMARK RUNNER       ")
    print("=" * 60)

    # 1. Model size
    model_size_bytes = pt_file.stat().st_size
    model_size_mb = round(model_size_bytes / (1024.0 * 1024.0), 2)
    print(f"[Benchmark] PyTorch model: {pt_file} ({model_size_mb} MB)")

    # 2. PyTorch CPU Benchmark (100 frames, imgsz=640, device="cpu")
    from ultralytics import YOLO

    model = YOLO(str(pt_file))

    # Sample input
    sample_img_path = REPO_ROOT / "ab_autos.png"
    if sample_img_path.exists():
        dummy_img = cv2.imread(str(sample_img_path))
    else:
        dummy_img = np.zeros((480, 640, 3), dtype=np.uint8)

    # Warmup
    for _ in range(5):
        model.predict(dummy_img, imgsz=640, device="cpu", verbose=False)

    tracemalloc.start()
    t0 = time.perf_counter()

    for i in range(n_frames):
        model.predict(dummy_img, imgsz=640, device="cpu", verbose=False)

    t_elapsed = time.perf_counter() - t0
    current_ram, peak_ram = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    avg_latency_ms = (t_elapsed / n_frames) * 1000.0
    avg_fps_cpu = round(n_frames / t_elapsed, 2)
    peak_ram_mb = round(peak_ram / (1024.0 * 1024.0), 2)

    print(f"[Benchmark] PyTorch CPU: {n_frames} frames in {t_elapsed:.2f}s -> {avg_fps_cpu} FPS ({avg_latency_ms:.1f} ms/frame)")
    print(f"[Benchmark] Peak RAM: {peak_ram_mb} MB")

    # 3. Telemetry byte efficiency
    tel_file = Path(telemetry_path)
    if not tel_file.exists():
        fixture = REPO_ROOT / "tests" / "fixtures" / "telemetry_fixture.parquet"
        if fixture.exists():
            tel_file = fixture

    telemetry_bytes_per_min = 0.0
    if tel_file.exists():
        t_bytes = tel_file.stat().st_size
        try:
            df = pq.read_table(tel_file).to_pandas()
            if not df.empty and "video_time_s" in df.columns:
                dur_s = float(df["video_time_s"].max() - df["video_time_s"].min())
                dur_min = max(0.05, dur_s / 60.0)
                telemetry_bytes_per_min = round(t_bytes / dur_min, 2)
        except Exception:
            telemetry_bytes_per_min = float(t_bytes)
    print(f"[Benchmark] Telemetry bandwidth: {telemetry_bytes_per_min:.1f} bytes/video-minute")

    # 4. ONNX Export and Benchmark
    fps_onnx = None
    onnx_path = pt_file.with_suffix(".onnx")
    try:
        if not onnx_path.exists():
            print("[Benchmark] Exporting model to ONNX...")
            onnx_export_file = model.export(format="onnx", imgsz=640, dynamic=False)
            onnx_path = Path(onnx_export_file)

        import onnxruntime as ort

        sess_options = ort.SessionOptions()
        sess_options.intra_op_num_threads = os.cpu_count() or 4
        ort_sess = ort.InferenceSession(str(onnx_path), sess_options, providers=["CPUExecutionProvider"])
        input_name = ort_sess.get_inputs()[0].name
        dummy_tensor = np.zeros((1, 3, 640, 640), dtype=np.float32)

        # Warmup
        for _ in range(5):
            ort_sess.run(None, {input_name: dummy_tensor})

        t0_onnx = time.perf_counter()
        n_onnx = 60
        for _ in range(n_onnx):
            ort_sess.run(None, {input_name: dummy_tensor})
        t_onnx = time.perf_counter() - t0_onnx
        fps_onnx = round(n_onnx / t_onnx, 2)
        print(f"[Benchmark] ONNX CPU: {fps_onnx} FPS ({(t_onnx/n_onnx)*1000:.1f} ms/frame)")
    except Exception as e:
        print(f"[Benchmark] ONNX evaluation skipped/failed: {e}")

    # 5. INT8 Quantization (timeboxed)
    fps_int8 = None
    int8_path = pt_file.parent / f"{pt_file.stem}_int8.onnx"
    try:
        from onnxruntime.quantization import QuantType, quantize_dynamic

        if not int8_path.exists() and onnx_path.exists():
            print("[Benchmark] Attempting dynamic INT8 quantization...")
            quantize_dynamic(str(onnx_path), str(int8_path), weight_type=QuantType.QUInt8)

        if int8_path.exists():
            ort_int8_sess = ort.InferenceSession(str(int8_path), providers=["CPUExecutionProvider"])
            inp_int8 = ort_int8_sess.get_inputs()[0].name
            for _ in range(5):
                ort_int8_sess.run(None, {inp_int8: dummy_tensor})
            t0_int8 = time.perf_counter()
            for _ in range(40):
                ort_int8_sess.run(None, {inp_int8: dummy_tensor})
            t_int8 = time.perf_counter() - t0_int8
            fps_int8 = round(40 / t_int8, 2)
            print(f"[Benchmark] ONNX INT8 CPU: {fps_int8} FPS ({(t_int8/40)*1000:.1f} ms/frame)")
    except Exception as e:
        print(f"[Benchmark] INT8 quantization skipped: {e}")

    # Compile report
    report = {
        "model_size_mb": model_size_mb,
        "avg_fps_cpu": avg_fps_cpu,
        "peak_ram_mb": peak_ram_mb,
        "telemetry_bytes_per_min": telemetry_bytes_per_min,
    }
    if fps_onnx is not None:
        report["fps_onnx"] = fps_onnx
    if fps_int8 is not None:
        report["fps_int8"] = fps_int8

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print("=" * 60)
    print(f"Report written to: {out_file}")
    print(json.dumps(report, indent=2))
    print("=" * 60)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Edge performance benchmark.")
    parser.add_argument("--model", type=str, default=None, help="Path to .pt model weights")
    parser.add_argument("--output", type=str, default=None, help="Path to perf_report.json")
    parser.add_argument("--telemetry", type=str, default=None, help="Path to telemetry parquet")
    parser.add_argument("--frames", type=int, default=100, help="Number of benchmark frames")
    args = parser.parse_args()

    run_benchmark(
        model_path=args.model,
        output_path=args.output,
        telemetry_path=args.telemetry,
        n_frames=args.frames,
    )


if __name__ == "__main__":
    main()
