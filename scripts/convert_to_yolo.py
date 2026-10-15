#!/usr/bin/env python3
"""Convert IDD-FG / FGVD VOC annotations to YOLO format with 5 canonical classes.

Taxonomy:
  0: auto_rickshaw
  1: bus
  2: car
  3: motorcycle
  4: truck
"""

from __future__ import annotations

import argparse
from collections import Counter
import os
from pathlib import Path
import random
import shutil
import xml.etree.ElementTree as ET
import yaml

try:
    import cv2
    import numpy as np
except ImportError:
    cv2 = None
    np = None

CANONICAL_CLASSES = [
    "auto_rickshaw",
    "bus",
    "car",
    "motorcycle",
    "truck",
]
CLASS_TO_ID = {name: idx for idx, name in enumerate(CANONICAL_CLASSES)}


def map_class_name(raw_name: str) -> str | None:
    """Map raw class string from annotation to canonical 5 classes."""
    clean = raw_name.strip().lower()

    # 1. auto_rickshaw
    if any(clean.startswith(p) for p in ("autorickshaw", "rickshaw", "auto_rickshaw", "e-rickshaw", "e_rickshaw")):
        return "auto_rickshaw"

    # 2. bus
    if clean.startswith("bus") or clean.startswith("mini-bus") or clean.startswith("minibus"):
        return "bus"

    # 3. motorcycle (includes scooters, mopeds, two-wheelers)
    if any(clean.startswith(p) for p in ("motorcycle", "scooter", "moped", "two-wheeler", "twowheeler", "two_wheeler")):
        return "motorcycle"

    # 4. car
    if clean.startswith("car"):
        return "car"

    # 5. truck
    if any(clean.startswith(p) for p in ("truck", "lorry", "tempo", "goods", "pickup", "van")):
        return "truck"

    return None


def parse_voc_xml(xml_path: Path):
    """Parse VOC XML file and extract image size and bounding boxes."""
    tree = ET.parse(xml_path)
    root = tree.getroot()

    size_elem = root.find("size")
    if size_elem is None:
        return 0, 0, []

    w_elem = size_elem.find("width")
    h_elem = size_elem.find("height")
    width = float(w_elem.text.strip()) if w_elem is not None and w_elem.text else 0
    height = float(h_elem.text.strip()) if h_elem is not None and h_elem.text else 0

    objects = []
    for obj in root.findall("object"):
        name_elem = obj.find("name")
        bndbox = obj.find("bndbox")
        if name_elem is None or not name_elem.text or bndbox is None:
            continue
        raw_name = name_elem.text.strip()
        try:
            xmin = float(bndbox.find("xmin").text)
            ymin = float(bndbox.find("ymin").text)
            xmax = float(bndbox.find("xmax").text)
            ymax = float(bndbox.find("ymax").text)
            objects.append((raw_name, xmin, ymin, xmax, ymax))
        except (TypeError, ValueError, AttributeError):
            continue

    return width, height, objects


def convert_dataset(root: Path, out_dir: Path, qa: bool = False, seed: int = 42, yaml_path: Path | None = None):
    """Convert VOC dataset to YOLO format."""
    random.seed(seed)
    root = root.resolve()
    out_dir = out_dir.resolve()

    splits = ["train", "val", "test"]
    # Verify split directories
    has_splits = all((root / s).is_dir() for s in splits)

    images_out = {s: out_dir / "images" / s for s in splits}
    labels_out = {s: out_dir / "labels" / s for s in splits}
    for s in splits:
        images_out[s].mkdir(parents=True, exist_ok=True)
        labels_out[s].mkdir(parents=True, exist_ok=True)

    # Stats tracking
    stats = {
        "images_per_split": Counter(),
        "boxes_per_class": Counter(),
        "dropped_small_boxes": 0,
        "dropped_unmapped_boxes": 0,
        "background_images": Counter(),
        "excess_background_dropped": 0,
    }

    # Find paired xml and image files
    split_items = {s: [] for s in splits}

    if has_splits:
        for s in splits:
            s_dir = root / s
            anno_dir = s_dir / "annos" if (s_dir / "annos").is_dir() else s_dir
            img_dir = s_dir / "images" if (s_dir / "images").is_dir() else s_dir

            for xml_file in sorted(anno_dir.glob("*.xml")):
                stem = xml_file.stem
                # Find matching image
                img_file = None
                for ext in (".jpg", ".jpeg", ".png", ".JPG"):
                    cand = img_dir / f"{stem}{ext}"
                    if cand.is_file():
                        img_file = cand
                        break
                if img_file:
                    split_items[s].append((xml_file, img_file))
    else:
        # Fallback: scan all XMLs and randomly split 80/10/10
        all_pairs = []
        for xml_file in sorted(root.rglob("*.xml")):
            stem = xml_file.stem
            parent = xml_file.parent
            img_cand = parent.parent / "images" / f"{stem}.jpg"
            if not img_cand.is_file():
                img_cand = parent / f"{stem}.jpg"
            if img_cand.is_file():
                all_pairs.append((xml_file, img_cand))
        random.shuffle(all_pairs)
        n = len(all_pairs)
        n_train = int(0.8 * n)
        n_val = int(0.1 * n)
        split_items["train"] = all_pairs[:n_train]
        split_items["val"] = all_pairs[n_train:n_train + n_val]
        split_items["test"] = all_pairs[n_train + n_val:]

    converted_train_pairs = []

    for s in splits:
        items = split_items[s]
        processed_pairs = []

        for xml_file, img_file in items:
            w, h, raw_boxes = parse_voc_xml(xml_file)
            if w <= 0 or h <= 0:
                if cv2 is not None and img_file.exists():
                    im = cv2.imread(str(img_file))
                    if im is not None:
                        h, w = im.shape[:2]
                if w <= 0 or h <= 0:
                    continue

            yolo_lines = []
            for raw_name, xmin, ymin, xmax, ymax in raw_boxes:
                cname = map_class_name(raw_name)
                if cname is None:
                    stats["dropped_unmapped_boxes"] += 1
                    continue

                bw = xmax - xmin
                bh = ymax - ymin
                if bw < 4.0 or bh < 4.0:
                    stats["dropped_small_boxes"] += 1
                    continue

                # Clamp to image boundaries
                xmin = max(0.0, min(float(xmin), w))
                ymin = max(0.0, min(float(ymin), h))
                xmax = max(0.0, min(float(xmax), w))
                ymax = max(0.0, min(float(ymax), h))

                cx = (xmin + xmax) / (2.0 * w)
                cy = (ymin + ymax) / (2.0 * h)
                norm_w = (xmax - xmin) / w
                norm_h = (ymax - ymin) / h

                cx = max(0.0, min(1.0, cx))
                cy = max(0.0, min(1.0, cy))
                norm_w = max(0.0, min(1.0, norm_w))
                norm_h = max(0.0, min(1.0, norm_h))

                cid = CLASS_TO_ID[cname]
                yolo_lines.append(f"{cid} {cx:.6f} {cy:.6f} {norm_w:.6f} {norm_h:.6f}")
                stats["boxes_per_class"][cname] += 1

            processed_pairs.append((img_file, yolo_lines))

        # Handle background capping for train
        if s == "train":
            pos_pairs = [p for p in processed_pairs if len(p[1]) > 0]
            bg_pairs = [p for p in processed_pairs if len(p[1]) == 0]
            max_bg = int(0.10 * len(pos_pairs))
            if len(bg_pairs) > max_bg:
                stats["excess_background_dropped"] = len(bg_pairs) - max_bg
                bg_pairs = bg_pairs[:max_bg]
            final_pairs = pos_pairs + bg_pairs
            random.shuffle(final_pairs)
        else:
            final_pairs = processed_pairs

        # Write files
        for img_file, yolo_lines in final_pairs:
            stem = img_file.stem
            dest_img = images_out[s] / img_file.name
            dest_lbl = labels_out[s] / f"{stem}.txt"

            # Create symlink or copy image
            if not dest_img.exists():
                try:
                    os.symlink(img_file.resolve(), dest_img)
                except OSError:
                    shutil.copy2(img_file, dest_img)

            dest_lbl.write_text("\n".join(yolo_lines) + ("\n" if yolo_lines else ""), encoding="utf-8")
            stats["images_per_split"][s] += 1
            if not yolo_lines:
                stats["background_images"][s] += 1

            if s == "train" and yolo_lines:
                converted_train_pairs.append((dest_img, dest_lbl))

    # Write data.yaml
    target_yaml = Path(yaml_path) if yaml_path else Path("models/finetuned/data.yaml")
    target_yaml.parent.mkdir(parents=True, exist_ok=True)
    yaml_content = {
        "path": str(out_dir.resolve()),
        "train": "images/train",
        "val": "images/val",
        "test": "images/test",
        "names": {idx: name for idx, name in enumerate(CANONICAL_CLASSES)},
    }
    with open(target_yaml, "w", encoding="utf-8") as f:
        yaml.dump(yaml_content, f, sort_keys=False)

    # QA contact sheet if requested
    if qa and cv2 is not None and np is not None and converted_train_pairs:
        qa_samples = random.sample(converted_train_pairs, min(12, len(converted_train_pairs)))
        tiles = []
        colors = {
            0: (0, 165, 255),   # auto_rickshaw: orange
            1: (0, 0, 255),     # bus: red
            2: (255, 0, 0),     # car: blue
            3: (0, 255, 255),   # motorcycle: yellow
            4: (255, 0, 255),   # truck: magenta
        }
        for img_p, lbl_p in qa_samples:
            img = cv2.imread(str(img_p))
            if img is None:
                continue
            h, w = img.shape[:2]
            lbl_text = lbl_p.read_text(encoding="utf-8")
            for line in lbl_text.splitlines():
                parts = line.strip().split()
                if len(parts) == 5:
                    cid = int(parts[0])
                    cx, cy, bw, bh = map(float, parts[1:])
                    x1 = int((cx - bw / 2.0) * w)
                    y1 = int((cy - bh / 2.0) * h)
                    x2 = int((cx + bw / 2.0) * w)
                    y2 = int((cy + bh / 2.0) * h)
                    color = colors.get(cid, (0, 255, 0))
                    cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
                    cname = CANONICAL_CLASSES[cid] if cid < len(CANONICAL_CLASSES) else str(cid)
                    cv2.putText(img, cname, (x1, max(20, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
            thumb = cv2.resize(img, (480, 270))
            tiles.append(thumb)

        # Build contact sheet (3 cols x 4 rows)
        if len(tiles) >= 1:
            while len(tiles) < 12:
                tiles.append(np.zeros((270, 480, 3), dtype=np.uint8))
            rows = [np.hstack(tiles[i * 3:(i + 1) * 3]) for i in range(4)]
            sheet = np.vstack(rows)
            qa_out_path = out_dir / "qa_sheet.png"
            cv2.imwrite(str(qa_out_path), sheet)
            print(f"QA contact sheet saved: {qa_out_path}")

    # Print compact summary (under 25 lines)
    print("=== YOLO Conversion Summary ===")
    print(f"Data YAML written: {target_yaml.resolve()}")
    print("Images per split:")
    for s in splits:
        print(f"  {s:8s}: {stats['images_per_split'][s]} (bg: {stats['background_images'][s]})")
    print("Boxes per canonical class:")
    for cname in CANONICAL_CLASSES:
        print(f"  {cname:15s}: {stats['boxes_per_class'][cname]}")
    print(f"Dropped boxes (<4px): {stats['dropped_small_boxes']}")
    print(f"Dropped unmapped boxes: {stats['dropped_unmapped_boxes']}")
    if stats["excess_background_dropped"] > 0:
        print(f"Excess background dropped by 10% cap: {stats['excess_background_dropped']}")
    print("=== Conversion Complete ===")


def main():
    parser = argparse.ArgumentParser(description="Convert IDD-FG VOC annotations to YOLO format.")
    parser.add_argument("--root", type=str, required=True, help="Root path of the raw dataset.")
    parser.add_argument("--out-dir", type=str, default="/home/g1/projects/finetune_workspace/dataset",
                        help="Output directory for YOLO formatted dataset.")
    parser.add_argument("--qa", action="store_true", help="Generate 12-image contact sheet qa_sheet.png.")
    args = parser.parse_args()

    convert_dataset(root=Path(args.root), out_dir=Path(args.out_dir), qa=args.qa)


if __name__ == "__main__":
    main()
