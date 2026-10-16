#!/usr/bin/env python3
"""Convert IITM-HeTra (Chennai fixed-camera traffic) VOC XMLs to the 5-class YOLO taxonomy.

Class mapping (HeTra -> canonical):
  Auto   -> auto_rickshaw
  Car    -> car
  Person -> motorcycle   (HeTra labels two-wheelers under 'Person')
  Bus    -> bus          (HeTra 'HMV' heavy vehicles released as 'Bus')
  anything else -> dropped

Source layout expected:
  <root>/images/*.jpg
  <root>/xmls/*.xml

Output: Ultralytics images/labels dirs (single split, all frames for training).
"""

from __future__ import annotations

import argparse
import os
import shutil
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

CLASS_MAP = {
    "auto": "auto_rickshaw",
    "car": "car",
    "person": "motorcycle",
    "bus": "bus",
}
CLASS_TO_ID = {"auto_rickshaw": 0, "bus": 1, "car": 2, "motorcycle": 3, "truck": 4}


def parse_voc(xml_path: Path):
    root = ET.parse(xml_path).getroot()
    size = root.find("size")
    if size is None:
        return 0, 0, []
    w = float(size.findtext("width") or 0)
    h = float(size.findtext("height") or 0)
    objs = []
    for obj in root.findall("object"):
        name = (obj.findtext("name") or "").strip().lower()
        box = obj.find("bndbox")
        if not name or box is None:
            continue
        try:
            x1 = float(box.findtext("xmin")); y1 = float(box.findtext("ymin"))
            x2 = float(box.findtext("xmax")); y2 = float(box.findtext("ymax"))
        except (TypeError, ValueError):
            continue
        objs.append((name, x1, y1, x2, y2))
    return w, h, objs


def main():
    ap = argparse.ArgumentParser(description="Convert IITM-HeTra VOC XMLs to 5-class YOLO.")
    ap.add_argument("--root", required=True, help="Dataset-1 root (contains images/ and xmls/).")
    ap.add_argument("--out", required=True, help="Output dir (images/train + labels/train created).")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    out = Path(args.out).resolve()
    img_out = out / "images" / "train"
    lbl_out = out / "labels" / "train"
    img_out.mkdir(parents=True, exist_ok=True)
    lbl_out.mkdir(parents=True, exist_ok=True)

    stats = Counter()
    dropped = Counter()
    n_imgs = 0

    # Dataset-1 ships as trainval (images/, xmls/) + test (images_test/, xmls_test/)
    pairs = [("images", "xmls"), ("images_test", "xmls_test")]
    xml_files = []
    for img_sub, xml_sub in pairs:
        xml_files.extend((root / xml_sub).glob("*.xml"))

    for xml in sorted(xml_files):
        img = None
        for img_sub, xml_sub in pairs:
            if xml.parent.name != xml_sub:
                continue
            for ext in (".jpg", ".jpeg", ".png"):
                cand = root / img_sub / f"{xml.stem}{ext}"
                if cand.is_file():
                    img = cand
                    break
            break
        if img is None:
            stats["missing_image"] += 1
            continue

        w, h, objs = parse_voc(xml)
        if w <= 0 or h <= 0:
            stats["bad_size"] += 1
            continue

        lines = []
        for name, x1, y1, x2, y2 in objs:
            cname = CLASS_MAP.get(name)
            if cname is None:
                dropped[name] += 1
                continue
            if x2 - x1 < 4 or y2 - y1 < 4:
                stats["tiny"] += 1
                continue
            x1 = max(0.0, min(x1, w)); y1 = max(0.0, min(y1, h))
            x2 = max(0.0, min(x2, w)); y2 = max(0.0, min(y2, h))
            cx, cy = (x1 + x2) / 2 / w, (y1 + y2) / 2 / h
            bw, bh = (x2 - x1) / w, (y2 - y1) / h
            lines.append(f"{CLASS_TO_ID[cname]} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}")
            stats[cname] += 1

        stem = f"hetra_{xml.stem}"
        try:
            os.link(img, img_out / f"{stem}{img.suffix}")
        except OSError:
            shutil.copy2(img, img_out / f"{stem}{img.suffix}")
        (lbl_out / f"{stem}.txt").write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
        n_imgs += 1

    print("=== HeTra -> YOLO conversion ===")
    print(f"Images written : {n_imgs}")
    print(f"Boxes/class    : {dict(stats)}")
    if dropped:
        print(f"Dropped labels : {dict(dropped)}")
    print(f"Output         : {out}")


if __name__ == "__main__":
    main()
