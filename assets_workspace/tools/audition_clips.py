"""
Audition video candidates for Indian traffic intersection digital twin.
Runs fine-tuned YOLO model (models/finetuned/best.pt) on candidate clips.
Reports:
  - Duration, resolution, fps
  - Mean vehicles/frame
  - Class histogram (auto_rickshaw, motorcycle, car, bus, truck)
  - % frames with a bus/truck
  - Mean brightness (0-255 scale)
  - Comparison table and winner evaluation
"""

import os
import sys
import json
import cv2
import numpy as np
from ultralytics import YOLO

CANDIDATES = [
    {
        "id": "candidate_1",
        "name": "Candidate 1: Delhi Congested Intersection",
        "path": "assets_workspace/candidates/candidate_1_delhi.mp4",
        "source_url": "https://www.youtube.com/watch?v=iEIk3RpV6RA",
        "uploader": "Sound Spirit",
        "license": "Creative Commons Attribution license (reuse allowed) (CC BY 3.0 / CC BY 4.0)",
        "location": "New Delhi, India"
    },
    {
        "id": "candidate_2",
        "name": "Candidate 2: Vikram 450d Urban Traffic",
        "path": "assets_workspace/candidates/candidate_2_vikram.mp4",
        "source_url": "https://www.youtube.com/watch?v=av4txy2jYCI",
        "uploader": "Vikram 450d",
        "license": "Creative Commons Attribution license (reuse allowed) (CC BY 3.0 / CC BY 4.0)",
        "location": "Urban Roadway, India"
    },
    {
        "id": "candidate_3",
        "name": "Candidate 3: Tank Bund Hyderabad Traffic",
        "path": "assets_workspace/candidates/candidate_3_hyderabad.mp4",
        "source_url": "https://www.youtube.com/watch?v=WdFFCCUi0-8",
        "uploader": "Creative Commons",
        "license": "Creative Commons Attribution license (reuse allowed) (CC BY 3.0 / CC BY 4.0)",
        "location": "Tank Bund, Hyderabad, India"
    }
]

TARGET_CLASSES = {"car", "motorcycle", "auto_rickshaw", "bus", "truck"}
MODEL_PATH = "models/finetuned/best.pt"
NUM_SAMPLE_FRAMES = 30
CONF_THRESHOLD = 0.30

def get_video_meta(cap):
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    duration_s = total_frames / fps if fps > 0 else 0.0
    return {
        "fps": fps,
        "total_frames": total_frames,
        "width": width,
        "height": height,
        "resolution": f"{width}x{height}",
        "duration_s": duration_s
    }

def audition_candidate(cand, model):
    filepath = cand["path"]
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return None

    cap = cv2.VideoCapture(filepath)
    if not cap.isOpened():
        print(f"Failed to open video: {filepath}")
        return None

    meta = get_video_meta(cap)
    total_frames = meta["total_frames"]

    # Choose 30 evenly-spaced frames, avoiding immediate start/end boundaries
    start_f = min(int(meta["fps"] * 1.0), total_frames // 4)
    end_f = max(total_frames - int(meta["fps"] * 1.0), 3 * total_frames // 4)
    if end_f <= start_f or total_frames < NUM_SAMPLE_FRAMES:
        frame_indices = np.linspace(0, max(0, total_frames - 1), min(total_frames, NUM_SAMPLE_FRAMES), dtype=int)
    else:
        frame_indices = np.linspace(start_f, end_f, NUM_SAMPLE_FRAMES, dtype=int)

    # Class mapping
    model_names = model.names
    active_class_ids = {
        cid: name for cid, name in model_names.items() if name in TARGET_CLASSES
    }

    brightnesses = []
    class_counts_total = {c: 0 for c in ["auto_rickshaw", "motorcycle", "car", "bus", "truck"]}
    frames_with_heavy = 0
    sampled_frame_counts = []
    per_frame_details = []

    for idx, f_idx in enumerate(frame_indices):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(f_idx))
        ret, frame = cap.read()
        if not ret or frame is None:
            continue

        # Brightness calculation: average luma
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        brightness = float(gray.mean())
        brightnesses.append(brightness)

        # Inference
        results = model(frame, conf=CONF_THRESHOLD, device="cpu", verbose=False)
        boxes = results[0].boxes

        frame_counts = {c: 0 for c in ["auto_rickshaw", "motorcycle", "car", "bus", "truck"]}
        has_heavy = False

        if boxes is not None and len(boxes) > 0:
            for box in boxes:
                cid = int(box.cls.item())
                if cid in active_class_ids:
                    cname = active_class_ids[cid]
                    frame_counts[cname] += 1
                    class_counts_total[cname] += 1
                    if cname in ("bus", "truck"):
                        has_heavy = True

        if has_heavy:
            frames_with_heavy += 1

        v_frame = sum(frame_counts.values())
        sampled_frame_counts.append(v_frame)
        per_frame_details.append({
            "frame_idx": int(f_idx),
            "brightness": brightness,
            "counts": frame_counts,
            "total_vehicles": v_frame
        })

    cap.release()

    valid_frames = len(sampled_frame_counts)
    if valid_frames == 0:
        return None

    mean_vehicles = float(np.mean(sampled_frame_counts))
    mean_brightness = float(np.mean(brightnesses))
    pct_heavy_frames = float(frames_with_heavy / valid_frames * 100.0)
    autos_per_frame = float(class_counts_total["auto_rickshaw"] / valid_frames)
    motos_per_frame = float(class_counts_total["motorcycle"] / valid_frames)
    cars_per_frame = float(class_counts_total["car"] / valid_frames)
    buses_per_frame = float(class_counts_total["bus"] / valid_frames)
    trucks_per_frame = float(class_counts_total["truck"] / valid_frames)

    # Winner evaluation:
    # Criteria: density 8-25 vehicles/frame, autos + 2-wheelers present, >=1 bus/truck, good lighting
    density_pass = 8.0 <= mean_vehicles <= 25.0
    autos_pass = class_counts_total["auto_rickshaw"] > 0
    motos_pass = class_counts_total["motorcycle"] > 0
    heavy_pass = (class_counts_total["bus"] + class_counts_total["truck"]) >= 1
    lighting_pass = mean_brightness >= 70.0  # not dark

    eligible = density_pass and autos_pass and motos_pass and heavy_pass and lighting_pass

    report = {
        "candidate": cand,
        "meta": meta,
        "valid_frames_sampled": valid_frames,
        "mean_vehicles_per_frame": round(mean_vehicles, 2),
        "mean_brightness": round(mean_brightness, 1),
        "pct_frames_with_bus_or_truck": round(pct_heavy_frames, 1),
        "class_counts_total": class_counts_total,
        "per_frame_averages": {
            "auto_rickshaw": round(autos_per_frame, 2),
            "motorcycle": round(motos_per_frame, 2),
            "car": round(cars_per_frame, 2),
            "bus": round(buses_per_frame, 2),
            "truck": round(trucks_per_frame, 2)
        },
        "gates": {
            "density_8_to_25": density_pass,
            "autos_present": autos_pass,
            "two_wheelers_present": motos_pass,
            "heavy_present": heavy_pass,
            "good_lighting": lighting_pass,
            "eligible": eligible
        }
    }
    return report

def main():
    print(f"Loading fine-tuned model: {MODEL_PATH}")
    model = YOLO(MODEL_PATH)
    print(f"Loaded model classes: {model.names}")

    results = []
    for cand in CANDIDATES:
        print(f"\n--- Auditioning {cand['name']} ---")
        rep = audition_candidate(cand, model)
        if rep:
            results.append(rep)
            print(f"Resolution: {rep['meta']['resolution']} @ {rep['meta']['fps']:.1f} fps, Duration: {rep['meta']['duration_s']:.1f}s")
            print(f"Mean Vehicles/Frame: {rep['mean_vehicles_per_frame']}")
            print(f"Mean Brightness: {rep['mean_brightness']}")
            print(f"% Frames with Heavy (Bus/Truck): {rep['pct_frames_with_bus_or_truck']}%")
            print(f"Class Totals across 30 frames: {rep['class_counts_total']}")
            print(f"Per-Frame Avgs: Autos={rep['per_frame_averages']['auto_rickshaw']}, Motos={rep['per_frame_averages']['motorcycle']}, Cars={rep['per_frame_averages']['car']}, Bus={rep['per_frame_averages']['bus']}, Truck={rep['per_frame_averages']['truck']}")
            print(f"Gate Assessment: {rep['gates']}")

    # Save detailed JSON in assets_workspace/
    out_json = "assets_workspace/audition_results.json"
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"\nAudition results saved to {out_json}")

    # Generate Markdown Table
    print("\n" + "="*80)
    print("### CANDIDATE AUDITION COMPARISON TABLE")
    print("="*80)
    print("| Candidate | Resolution | FPS | Dur (s) | Mean Veh/Fr | Autos/Fr | Motos/Fr | Heavy (Bus/Trk) % | Brightness | Verdict |")
    print("| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |")
    for r in results:
        c = r["candidate"]
        m = r["meta"]
        g = r["gates"]
        verdict = "WINNER" if g["eligible"] else "DISQUALIFIED"
        print(f"| **{c['id']}** ({c['name'].split(':')[1].strip()}) | {m['resolution']} | {m['fps']:.1f} | {m['duration_s']:.1f} | {r['mean_vehicles_per_frame']} | {r['per_frame_averages']['auto_rickshaw']} | {r['per_frame_averages']['motorcycle']} | {r['pct_frames_with_bus_or_truck']}% | {r['mean_brightness']} | **{verdict}** |")

if __name__ == "__main__":
    main()
