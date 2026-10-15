#!/usr/bin/env python3
"""A/B evaluation script comparing stock YOLO26n vs fine-tuned best.pt.

Evaluates on video clip or image folder at conf=0.3.
Checks gating condition:
  SHIP fine-tuned ONLY IF:
    1. auto_rickshaw detected (> 0 across samples and boxes plausible on ab_autos.png)
    2. (car + motorcycle) detections drop < 10% vs stock COCO.
  Otherwise FALLBACK to stock COCO.
"""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path
import sys
import cv2
import numpy as np
import torch
from ultralytics import YOLO

CANONICAL_CLASSES = ["auto_rickshaw", "bus", "car", "motorcycle", "truck"]


def load_samples(source_path: Path, n: int = 100):
    """Load up to n evenly sampled frames (video) or images (dir)."""
    samples = []
    is_video = source_path.is_file() and source_path.suffix.lower() in {".mp4", ".avi", ".mov", ".mkv"}

    if is_video:
        cap = cv2.VideoCapture(str(source_path))
        if not cap.isOpened():
            print(f"ERROR: Cannot open video file {source_path}")
            sys.exit(1)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total_frames <= 0:
            print("ERROR: Video reports 0 frames.")
            sys.exit(1)
        sample_indices = set(np.linspace(0, total_frames - 1, min(n, total_frames), dtype=int))
        frame_idx = 0
        while cap.isOpened() and len(samples) < len(sample_indices):
            ret, frame = cap.read()
            if not ret:
                break
            if frame_idx in sample_indices:
                samples.append((f"frame_{frame_idx}", frame))
            frame_idx += 1
        cap.release()
    elif source_path.is_dir():
        img_extensions = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".JPG"}
        all_imgs = sorted([p for p in source_path.rglob("*") if p.suffix in img_extensions])
        if not all_imgs:
            print(f"ERROR: No image files found in {source_path}")
            sys.exit(1)
        step_indices = np.linspace(0, len(all_imgs) - 1, min(n, len(all_imgs)), dtype=int)
        for idx in step_indices:
            p = all_imgs[idx]
            img = cv2.imread(str(p))
            if img is not None:
                samples.append((p.name, img))
    else:
        print(f"ERROR: Invalid source path {source_path}")
        sys.exit(1)

    return samples, is_video


def run_ab_eval(
    source: str,
    stock_weights: str = "yolo26n.pt",
    finetuned_weights: str = "/home/g1/projects/finetune_workspace/runs/yolo26n_idd5/weights/best.pt",
    n: int = 100,
    conf: float = 0.3,
    out_img: str = "ab_autos.png",
    device: str = "0",
):
    source_p = Path(source).resolve()
    stock_p = Path(stock_weights)
    if not stock_p.is_file() and Path("yolo26n.pt").is_file():
        stock_p = Path("yolo26n.pt").resolve()
    ft_p = Path(finetuned_weights).resolve()

    if not ft_p.is_file():
        print(f"ERROR: Fine-tuned weights not found at {ft_p}")
        sys.exit(1)

    if not torch.cuda.is_available() and device != "cpu":
        device = "cpu"

    samples, is_video = load_samples(source_p, n=n)
    num_samples = len(samples)
    if num_samples == 0:
        print("ERROR: 0 samples loaded.")
        sys.exit(1)

    stock_model = YOLO(str(stock_p))
    ft_model = YOLO(str(ft_p))

    stock_counts = Counter()
    ft_counts = Counter()
    auto_crops = []

    stock_total_dets = 0
    ft_total_dets = 0

    for name, img in samples:
        h, w = img.shape[:2]

        # 1. Stock model inference
        res_stock = stock_model(img, conf=conf, device=device, verbose=False)[0]
        boxes_stock = res_stock.boxes
        if boxes_stock is not None and len(boxes_stock) > 0:
            for cls_id in boxes_stock.cls.cpu().numpy():
                cname = stock_model.names.get(int(cls_id), str(int(cls_id))).lower()
                if cname in {"car", "motorcycle", "bus", "truck"}:
                    stock_counts[cname] += 1
                    stock_total_dets += 1

        # 2. Fine-tuned model inference
        res_ft = ft_model(img, conf=conf, device=device, verbose=False)[0]
        boxes_ft = res_ft.boxes
        if boxes_ft is not None and len(boxes_ft) > 0:
            cls_ids = boxes_ft.cls.cpu().numpy()
            xyxys = boxes_ft.xyxy.cpu().numpy()
            confs = boxes_ft.conf.cpu().numpy()

            for cid, xyxy, cf in zip(cls_ids, xyxys, confs):
                cname = ft_model.names.get(int(cid), str(int(cid))).lower()
                ft_counts[cname] += 1
                ft_total_dets += 1

                # Collect auto_rickshaw crops for eyeball verification
                if cname == "auto_rickshaw" and len(auto_crops) < 6 and cf >= 0.35:
                    x1, y1, x2, y2 = map(int, xyxy)
                    # Add 10% margin
                    pad_x = int(0.1 * (x2 - x1))
                    pad_y = int(0.1 * (y2 - y1))
                    cx1 = max(0, x1 - pad_x)
                    cy1 = max(0, y1 - pad_y)
                    cx2 = min(w, x2 + pad_x)
                    cy2 = min(h, y2 + pad_y)
                    crop = img[cy1:cy2, cx1:cx2].copy()
                    if crop.size > 0:
                        # Draw box on crop relative to crop origin
                        bx1, by1 = x1 - cx1, y1 - cy1
                        bx2, by2 = x2 - cx1, y2 - cy1
                        cv2.rectangle(crop, (bx1, by1), (bx2, by2), (0, 165, 255), 2)
                        cv2.putText(crop, f"auto {cf:.2f}", (bx1, max(15, by1 - 5)),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 165, 255), 2)
                        thumb = cv2.resize(crop, (280, 280))
                        auto_crops.append(thumb)

    # Save contact sheet for auto-rickshaws
    if auto_crops:
        while len(auto_crops) < 6:
            auto_crops.append(np.zeros((280, 280, 3), dtype=np.uint8))
        row1 = np.hstack(auto_crops[:3])
        row2 = np.hstack(auto_crops[3:6])
        grid = np.vstack([row1, row2])
        out_path = Path(out_img).resolve()
        cv2.imwrite(str(out_path), grid)
        autos_rendered = True
    else:
        autos_rendered = False

    # Metrics computation
    mean_stock = stock_total_dets / num_samples
    mean_ft = ft_total_dets / num_samples

    stock_cm = stock_counts["car"] + stock_counts["motorcycle"]
    ft_cm = ft_counts["car"] + ft_counts["motorcycle"]

    if stock_cm > 0:
        cm_drop_pct = ((stock_cm - ft_cm) / stock_cm) * 100.0
    else:
        cm_drop_pct = 0.0

    auto_count = ft_counts["auto_rickshaw"]

    # Gate Evaluation
    # Gate condition: autos > 0 AND car+motorcycle drop < 10%
    gate_autos_detected = auto_count > 0
    gate_cm_drop_passed = cm_drop_pct < 10.0
    gate_passed = gate_autos_detected and gate_cm_drop_passed

    verdict_type = "FINAL" if is_video else "PROVISIONAL (domain mismatch: tested on validation images)"

    # Print summary under 40 lines
    print("=== A/B Evaluation: Stock YOLO26n vs Fine-Tuned IDD-5 ===")
    print(f"Source       : {source_p.name} ({'Video' if is_video else 'Image Directory'})")
    print(f"Samples      : {num_samples} frames/images evaluated at conf={conf}")
    print(f"Mean Dets/Fr : Stock = {mean_stock:.2f} | Fine-Tuned = {mean_ft:.2f}")
    print("-" * 55)
    print(f"{'Class':16s} | {'Stock (COCO)':14s} | {'Fine-Tuned (IDD)':16s}")
    print("-" * 55)
    for c in CANONICAL_CLASSES:
        sc = stock_counts.get(c, 0)
        fc = ft_counts.get(c, 0)
        print(f"{c:16s} | {sc:14d} | {fc:16d}")
    print("-" * 55)
    print(f"Car+Moto Sum : Stock = {stock_cm} | Fine-Tuned = {ft_cm}")
    print(f"Car+Moto Drop: {cm_drop_pct:+.1f}% (Gate threshold: drop must be < 10.0%)")
    print(f"Autos Found  : {auto_count} (Rendered to {out_img}: {autos_rendered})")
    print("-" * 55)
    print("VERDICT CRITERIA:")
    print("  1. auto_rickshaw > 0 and visually plausible: " + ("PASS" if gate_autos_detected else "FAIL"))
    print(f"  2. (car + motorcycle) drop < 10%:            " + ("PASS" if gate_cm_drop_passed else f"FAIL ({cm_drop_pct:.1f}% drop)"))
    print(f"VERDICT STATUS [{verdict_type}]:")
    if gate_passed:
        print("  --> [SHIP] Fine-tuned model PASSED all quantitative gates.")
        print("      Human check: verify plausible auto boxes on ab_autos.png.")
    else:
        print("  --> [FALLBACK] Gate FAILED. Keep stock yolo26n + document in README.")
    print("=========================================================")


def main():
    parser = argparse.ArgumentParser(description="A/B evaluation between stock yolo26n and fine-tuned model.")
    parser.add_argument("--source", type=str, required=True, help="Video clip or directory of images.")
    parser.add_argument("--stock", type=str, default="yolo26n.pt", help="Stock model weights.")
    parser.add_argument("--finetuned", type=str,
                        default="/home/g1/projects/finetune_workspace/runs/yolo26n_idd5/weights/best.pt",
                        help="Fine-tuned weights path.")
    parser.add_argument("--n", type=int, default=100, help="Number of samples to evaluate.")
    parser.add_argument("--conf", type=float, default=0.3, help="Detection confidence threshold.")
    parser.add_argument("--out-img", type=str, default="ab_autos.png", help="Output contact sheet.")
    parser.add_argument("--device", type=str, default="0", help="Inference device ('0' or 'cpu').")
    args = parser.parse_args()

    run_ab_eval(
        source=args.source,
        stock_weights=args.stock,
        finetuned_weights=args.finetuned,
        n=args.n,
        conf=args.conf,
        out_img=args.out_img,
        device=args.device,
    )


if __name__ == "__main__":
    main()
