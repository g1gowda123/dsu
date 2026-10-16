#!/usr/bin/env python3
"""Auto-label a folder of CCTV frames with a YOLO model to produce pseudo-labels.

Used for target-domain adaptation: mine frames from a municipal camera video,
pseudo-label them with the current model, and mix them into a fine-tune dataset.

Writes one YOLO .txt per image (next to it) and an optional annotated contact
sheet for quick visual review.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp"}


def autolabel(
    weights: str,
    frames_dir: str,
    conf: float = 0.35,
    device: str = "0",
    out_img: str | None = None,
    sheet_frames: int = 6,
):
    frames = Path(frames_dir).resolve()
    imgs = sorted(p for p in frames.iterdir() if p.suffix.lower() in IMG_EXTS)
    if not imgs:
        raise SystemExit(f"No images found in {frames}")

    model = YOLO(weights)
    total_boxes = 0
    per_class: dict[int, int] = {}
    frames_with_auto = 0
    tiles: list[np.ndarray] = []

    for p in imgs:
        res = model(str(p), conf=conf, device=device, verbose=False)[0]
        lines: list[str] = []
        if res.boxes is not None and len(res.boxes) > 0:
            for b in res.boxes:
                cid = int(b.cls.item())
                cx, cy, w, h = b.xywhn[0].tolist()
                lines.append(f"{cid} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
                per_class[cid] = per_class.get(cid, 0) + 1
            total_boxes += len(res.boxes)
            if 0 in {int(c) for c in res.boxes.cls.tolist()}:
                frames_with_auto += 1
        (frames / f"{p.stem}.txt").write_text(
            "\n".join(lines) + ("\n" if lines else ""), encoding="utf-8"
        )
        if out_img and len(tiles) < sheet_frames:
            annotated = res.plot()  # BGR ndarray with boxes drawn
            tiles.append(cv2.resize(annotated, (480, 270)))

    if out_img and tiles:
        while len(tiles) < sheet_frames:
            tiles.append(np.zeros((270, 480, 3), dtype=np.uint8))
        cols = 3
        rows = [np.hstack(tiles[i * cols:(i + 1) * cols]) for i in range(sheet_frames // cols)]
        cv2.imwrite(str(out_img), np.vstack(rows))
        print(f"Contact sheet saved: {Path(out_img).resolve()}")

    names = model.names
    pretty = {names.get(c, str(c)): n for c, n in sorted(per_class.items())}
    print(f"Auto-labeled {len(imgs)} frames -> {total_boxes} boxes @ conf>={conf}")
    print(f"Boxes per class: {pretty}")
    print(f"Frames containing auto_rickshaw: {frames_with_auto}")
    return total_boxes, per_class


def main():
    ap = argparse.ArgumentParser(description="Pseudo-label CCTV frames with a YOLO model.")
    ap.add_argument("--weights", required=True)
    ap.add_argument("--frames", required=True, help="Directory of extracted frames.")
    ap.add_argument("--conf", type=float, default=0.35)
    ap.add_argument("--device", default="0")
    ap.add_argument("--out-img", default=None, help="Optional annotated contact sheet path.")
    args = ap.parse_args()
    autolabel(args.weights, args.frames, args.conf, args.device, args.out_img)


if __name__ == "__main__":
    main()
