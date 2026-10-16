#!/usr/bin/env python3
"""Assemble a CCTV domain-adaptation dataset for the 5-class vehicle detector.

Mix:
  1. Target frames mined from municipal-camera video, pseudo-labeled by the
     current model. Frames containing auto_rickshaw (class 0) are upsampled
     because 3-wheelers are the key carbon-accounting class.
  2. IDD replay subset (real labels) to preserve the Indian 5-class taxonomy.

Produces Ultralytics-ready images/labels dirs + data.yaml.
"""

from __future__ import annotations

import argparse
import os
import random
import shutil
from pathlib import Path

import yaml

IMG_EXTS = {".jpg", ".jpeg", ".png"}
CLASS_NAMES = ["auto_rickshaw", "bus", "car", "motorcycle", "truck"]


def link_or_copy(src: Path, dst: Path):
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def label_contains(lbl_path: Path, cid: int = 0) -> bool:
    if not lbl_path.is_file():
        return False
    return any(line.split()[0] == str(cid) for line in lbl_path.read_text().splitlines() if line.strip())


def add_pseudo_dir(frames_dir: Path, out_img: Path, out_lbl: Path, repeat_auto: int, repeat_other: int, tag: str, counters: dict):
    for img in sorted(p for p in frames_dir.iterdir() if p.suffix.lower() in IMG_EXTS):
        lbl = img.with_suffix(".txt")
        repeats = repeat_auto if label_contains(lbl, 0) else repeat_other
        for r in range(repeats):
            stem = f"{tag}_{img.stem}" + (f"_r{r}" if repeats > 1 else "")
            link_or_copy(img, out_img / f"{stem}{img.suffix}")
            (out_lbl / f"{stem}.txt").write_text(
                lbl.read_text() if lbl.is_file() else "", encoding="utf-8"
            )
            counters["pseudo"] += 1
            if label_contains(lbl, 0):
                counters["pseudo_auto_frames"] += 1


def add_idd_split(idd_root: Path, split: str, out_img: Path, out_lbl: Path, n_auto: int, n_rand: int, seed: int, counters: dict):
    img_dir = idd_root / "images" / split
    lbl_dir = idd_root / "labels" / split
    stems = sorted(p.stem for p in lbl_dir.glob("*.txt"))
    auto_stems = [s for s in stems if label_contains(lbl_dir / f"{s}.txt", 0)]
    rand_stems = [s for s in stems if s not in set(auto_stems)]

    rng = random.Random(seed)
    rng.shuffle(auto_stems)
    rng.shuffle(rand_stems)
    chosen = auto_stems[:n_auto] + rand_stems[:n_rand]

    added = 0
    for s in chosen:
        img = img_dir / f"{s}.jpg"
        if not img.is_file():
            continue
        link_or_copy(img, out_img / f"idd_{s}.jpg")
        (out_lbl / f"idd_{s}.txt").write_text((lbl_dir / f"{s}.txt").read_text(), encoding="utf-8")
        added += 1
    counters["idd_" + split] += added
    print(f"  IDD {split}: added {added} (auto-containing: {min(n_auto, len(auto_stems))})")


def add_extra_train_dir(root: Path, out_img: Path, out_lbl: Path, tag: str, counters: dict):
    """Merge a YOLO-format dataset dir (images/train + labels/train) into the train split."""
    img_dir = root / "images" / "train"
    lbl_dir = root / "labels" / "train"
    n = 0
    for img in sorted(p for p in img_dir.iterdir() if p.suffix.lower() in IMG_EXTS):
        lbl = lbl_dir / f"{img.stem}.txt"
        if not lbl.is_file():
            continue
        link_or_copy(img, out_img / f"{tag}_{img.name}")
        (out_lbl / f"{tag}_{img.stem}.txt").write_text(lbl.read_text(), encoding="utf-8")
        n += 1
    counters["extra"] += n
    print(f"  extra ({tag}): added {n}")


def main():
    ap = argparse.ArgumentParser(description="Build CCTV adaptation dataset (target frames + IDD replay).")
    ap.add_argument("--target-dirs", required=True, help="Comma-separated dirs of pseudo-labeled target frames (main domain).")
    ap.add_argument("--aux-dirs", default="", help="Comma-separated dirs of pseudo-labeled auxiliary frames.")
    ap.add_argument("--extra-train-dirs", default="", help="Comma-separated YOLO dirs (images/train + labels/train) merged into train.")
    ap.add_argument("--target-val-dir", required=True, help="Held-out pseudo-labeled target frames for validation.")
    ap.add_argument("--idd-root", required=True, help="IDD YOLO dataset root (images/labels/train,val).")
    ap.add_argument("--out", required=True, help="Output dataset dir.")
    ap.add_argument("--idd-train-auto", type=int, default=350)
    ap.add_argument("--idd-train-rand", type=int, default=150)
    ap.add_argument("--idd-val-auto", type=int, default=40)
    ap.add_argument("--idd-val-rand", type=int, default=60)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    out = Path(args.out).resolve()
    img_train = out / "images" / "train"
    lbl_train = out / "labels" / "train"
    img_val = out / "images" / "val"
    lbl_val = out / "labels" / "val"
    for d in (img_train, lbl_train, img_val, lbl_val):
        d.mkdir(parents=True, exist_ok=True)

    counters = {"pseudo": 0, "pseudo_auto_frames": 0, "idd_train": 0, "idd_val": 0, "extra": 0}

    print("Target domain frames (auto x3, other x2):")
    for d in args.target_dirs.split(","):
        add_pseudo_dir(Path(d.strip()).resolve(), img_train, lbl_train, 3, 2, "tgt", counters)
    for d in [x for x in args.aux_dirs.split(",") if x.strip()]:
        add_pseudo_dir(Path(d.strip()).resolve(), img_train, lbl_train, 2, 1, "aux", counters)

    for d in [x for x in args.extra_train_dirs.split(",") if x.strip()]:
        print(f"Extra dataset merge ({d.strip()}):")
        add_extra_train_dir(Path(d.strip()).resolve(), img_train, lbl_train, "hx", counters)

    print("Held-out target frames for val:")
    add_pseudo_dir(Path(args.target_val_dir).resolve(), img_val, lbl_val, 1, 1, "val", counters)

    idd_root = Path(args.idd_root).resolve()
    print("IDD replay:")
    add_idd_split(idd_root, "train", img_train, lbl_train, args.idd_train_auto, args.idd_train_rand, args.seed, counters)
    add_idd_split(idd_root, "val", img_val, lbl_val, args.idd_val_auto, args.idd_val_rand, args.seed, counters)

    n_train = len(list(img_train.iterdir()))
    n_val = len(list(img_val.iterdir()))

    # Per-class box histogram
    hist = {c: 0 for c in CLASS_NAMES}
    for txt in list(lbl_train.glob("*.txt")) + list(lbl_val.glob("*.txt")):
        for line in txt.read_text().splitlines():
            if line.strip():
                cid = int(line.split()[0])
                hist[CLASS_NAMES[cid]] += 1

    data_yaml = {
        "path": str(out),
        "train": "images/train",
        "val": "images/val",
        "names": {i: n for i, n in enumerate(CLASS_NAMES)},
    }
    yaml_path = out / "data.yaml"
    with open(yaml_path, "w", encoding="utf-8") as f:
        yaml.dump(data_yaml, f, sort_keys=False)

    print("=== Adaptation dataset summary ===")
    print(f"Output      : {out}")
    print(f"train/val   : {n_train} / {n_val} images")
    print(f"pseudo imgs : {counters['pseudo']} (auto-containing copies: {counters['pseudo_auto_frames']})")
    print(f"IDD replay  : train={counters['idd_train']} val={counters['idd_val']}")
    print(f"Boxes/class : {hist}")
    print(f"data.yaml   : {yaml_path}")


if __name__ == "__main__":
    main()
