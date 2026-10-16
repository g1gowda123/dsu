#!/usr/bin/env python3
"""Before/after comparison of two detectors on held-out CCTV frames.

Prints per-class detection counts for an old and a new model on the same
frames, and writes side-by-side annotated contact sheets (old | new) plus a
JSON counts report for the domain-adaptation decision.

Note: counts are detection-based (no ground truth). Use for quick
domain-adaptation triage; pair with eyeballed contact sheets.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

IMG_EXTS = {".jpg", ".jpeg", ".png"}


def run_model(model: YOLO, img_path: Path, conf: float, device: str):
    res = model(str(img_path), conf=conf, device=device, verbose=False)[0]
    counts: Counter = Counter()
    if res.boxes is not None and len(res.boxes) > 0:
        for c in res.boxes.cls.tolist():
            counts[model.names.get(int(c), str(c))] += 1
    return res, counts


def main():
    ap = argparse.ArgumentParser(description="Compare old vs new detector on held-out frames.")
    ap.add_argument("--old", required=True, help="Pre-adaptation weights.")
    ap.add_argument("--new", required=True, help="Post-adaptation weights.")
    ap.add_argument("--frames", required=True, help="Directory of held-out frames.")
    ap.add_argument("--conf", type=float, default=0.30)
    ap.add_argument("--device", default="0")
    ap.add_argument("--out-dir", default="artifacts")
    ap.add_argument("--max-sheet-frames", type=int, default=6)
    args = ap.parse_args()

    frames = sorted(p for p in Path(args.frames).resolve().iterdir() if p.suffix.lower() in IMG_EXTS)
    if not frames:
        raise SystemExit("No frames found.")

    old_model = YOLO(args.old)
    new_model = YOLO(args.new)

    old_total: Counter = Counter()
    new_total: Counter = Counter()
    per_frame = {}
    rows = []

    for p in frames:
        res_old, c_old = run_model(old_model, p, args.conf, args.device)
        res_new, c_new = run_model(new_model, p, args.conf, args.device)
        old_total.update(c_old)
        new_total.update(c_new)
        per_frame[p.name] = {"old": dict(c_old), "new": dict(c_new)}

        if len(rows) < args.max_sheet_frames:
            tile_old = cv2.resize(res_old.plot(), (640, 360))
            tile_new = cv2.resize(res_new.plot(), (640, 360))
            cv2.putText(tile_old, "OLD", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 3)
            cv2.putText(tile_new, "NEW", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 200, 0), 3)
            rows.append(np.hstack([tile_old, tile_new]))

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Split rows into sheets of 3 for sane image heights
    n_sheets = (len(rows) + 2) // 3
    for s in range(n_sheets):
        sheet = np.vstack(rows[s * 3:(s + 1) * 3])
        cv2.imwrite(str(out_dir / f"adapt_eval_sheet_{s + 1}.png"), sheet)
        print(f"Sheet saved: {(out_dir / f'adapt_eval_sheet_{s + 1}.png').resolve()}")

    report = {
        "frames": len(frames),
        "conf": args.conf,
        "old_weights": str(Path(args.old).resolve()),
        "new_weights": str(Path(args.new).resolve()),
        "old_totals": dict(old_total),
        "new_totals": dict(new_total),
        "per_frame": per_frame,
    }
    (out_dir / "adapt_eval_counts.json").write_text(json.dumps(report, indent=2))
    print(f"Counts JSON : {(out_dir / 'adapt_eval_counts.json').resolve()}")

    classes = sorted(set(old_total) | set(new_total))
    n = len(frames)
    print("=== Domain-adaptation detection counts (no GT; triage only) ===")
    print(f"Frames: {n} @ conf={args.conf}")
    print(f"{'Class':16s} | {'OLD total':>9s} | {'NEW total':>9s} | {'OLD/fr':>6s} | {'NEW/fr':>6s}")
    for c in classes:
        o, nw = old_total.get(c, 0), new_total.get(c, 0)
        print(f"{c:16s} | {o:9d} | {nw:9d} | {o / n:6.2f} | {nw / n:6.2f}")
    print(f"{'ALL':16s} | {sum(old_total.values()):9d} | {sum(new_total.values()):9d}")


if __name__ == "__main__":
    main()
