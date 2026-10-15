#!/usr/bin/env python3
"""Dataset probe script for IDD-FG / FGVD dataset.

Walks dataset boundedly, detects format, samples annotations, extracts class inventory,
and measures image resolutions, keeping stdout strictly under 70 lines.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import json
import os
from pathlib import Path
import random
import sys
import xml.etree.ElementTree as ET

try:
    import cv2
except ImportError:
    cv2 = None

try:
    from PIL import Image
except ImportError:
    Image = None


class OutputBuffer:
    """Buffers print output and guarantees max line count under 70 lines."""

    def __init__(self, max_lines: int = 68):
        self.max_lines = max_lines
        self.lines: list[str] = []
        self._truncated = False

    def print(self, *args, **kwargs):
        sep = kwargs.get("sep", " ")
        text = sep.join(str(a) for a in args)
        for line in text.splitlines():
            if len(self.lines) < self.max_lines:
                self.lines.append(line)
            elif not self._truncated:
                self.lines.append("[... truncated to stay under 70 lines ...]")
                self._truncated = True

    def flush(self):
        for line in self.lines:
            sys.stdout.write(line + "\n")
        sys.stdout.flush()


def bounded_walk(root: Path, max_depth: int = 3, max_entries: int = 50000):
    """Walk directory tree bounded by depth and max entry count."""
    root = root.resolve()
    root_depth = len(root.parts)
    entries_visited = 0

    all_files: list[Path] = []
    dir_ext_counts: dict[str, Counter] = defaultdict(Counter)
    ext_counter: Counter = Counter()
    split_dirs: set[str] = set()

    for dirpath, dirnames, filenames in os.walk(root):
        current = Path(dirpath)
        depth = len(current.parts) - root_depth
        if depth > max_depth:
            dirnames.clear()
            continue

        # Check for split dirs
        rel_dir = current.relative_to(root)
        rel_parts = rel_dir.parts
        for part in rel_parts:
            low = part.lower()
            if low in {"train", "val", "validation", "test", "testing"}:
                split_dirs.add(part)

        top_dir_key = str(Path(*rel_parts[:min(2, len(rel_parts))])) if rel_parts else "."

        for f in filenames:
            entries_visited += 1
            if entries_visited > max_entries:
                break
            fp = current / f
            all_files.append(fp)
            ext = fp.suffix.lower() if fp.suffix else "[no_ext]"
            ext_counter[ext] += 1
            dir_ext_counts[top_dir_key][ext] += 1

        if entries_visited > max_entries:
            break

    return all_files, ext_counter, dir_ext_counts, split_dirs, entries_visited


def is_annotation_candidate(p: Path) -> bool:
    """Heuristic to check if a file might be an annotation file."""
    ext = p.suffix.lower()
    name = p.name.lower()
    if name in {"classes.txt", "labels.txt", "notes.json"}:
        return False
    parts = [part.lower() for part in p.parts]
    in_anno_dir = any(k in part for part in parts for k in ("anno", "label", "xml", "annotation", "gt", "mask"))
    if ext in {".xml", ".json", ".csv"}:
        return True
    if ext == ".txt" and in_anno_dir:
        return True
    if ext == ".png" and in_anno_dir:
        return True
    return False


def is_image_candidate(p: Path) -> bool:
    """Check if file is an image and unlikely to be an annotation mask."""
    ext = p.suffix.lower()
    if ext not in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}:
        return False
    parts = [part.lower() for part in p.parts]
    if any(k in part for part in parts for k in ("anno", "label", "gt", "mask", "segmentation")):
        return False
    return True


def sample_file_head(p: Path) -> str:
    """Read first 15 lines or raw head truncated to 500 chars."""
    ext = p.suffix.lower()
    if ext == ".png" and Image is not None:
        try:
            with Image.open(p) as img:
                palette = img.getpalette()
                has_palette = palette is not None
                mode = img.mode
                size = img.size
                colors = img.getcolors(maxcolors=256)
                num_colors = len(colors) if colors else "unknown (>256)"
                return f"[PNG Mask/Image mode={mode} size={size} has_palette={has_palette} unique_colors_<=256={num_colors}]"
        except Exception as e:
            return f"[PNG inspect error: {e}]"

    try:
        lines = []
        with open(p, "r", encoding="utf-8", errors="replace") as f:
            for _ in range(15):
                line = f.readline()
                if not line:
                    break
                lines.append(line.rstrip("\r\n"))
        text = "\n".join(lines)
        if len(text) > 500:
            text = text[:497] + "..."
        return text
    except Exception as e:
        return f"[Error reading file: {e}]"


def parse_classes_from_file(p: Path) -> list[str]:
    """Parse class names or class IDs from a single annotation file."""
    ext = p.suffix.lower()
    classes = []
    try:
        if ext == ".xml":
            tree = ET.parse(p)
            root = tree.getroot()
            # Pascal VOC style: <object><name>...</name></object>
            for obj in root.findall(".//object"):
                name_elem = obj.find("name")
                if name_elem is not None and name_elem.text:
                    classes.append(name_elem.text.strip())
            # Alternate format: <annotation><object_name>
            if not classes:
                for elem in root.iter():
                    if elem.tag.lower() in {"name", "class", "label", "category"} and elem.text:
                        classes.append(elem.text.strip())
        elif ext == ".json":
            with open(p, "r", encoding="utf-8", errors="replace") as f:
                data = json.load(f)
            if isinstance(data, dict):
                # Check COCO format
                if "annotations" in data and isinstance(data["annotations"], list):
                    cat_map = {}
                    if "categories" in data and isinstance(data["categories"], list):
                        for cat in data["categories"]:
                            cat_map[cat.get("id")] = cat.get("name", str(cat.get("id")))
                    for ann in data["annotations"][:100]:
                        cid = ann.get("category_id")
                        classes.append(str(cat_map.get(cid, cid)))
                # Or other label dicts
                elif "labels" in data or "objects" in data:
                    objs = data.get("labels") or data.get("objects")
                    if isinstance(objs, list):
                        for item in objs:
                            if isinstance(item, dict):
                                name = item.get("name") or item.get("label") or item.get("category")
                                if name:
                                    classes.append(str(name))
        elif ext == ".txt":
            # YOLO txt: <class_id> <cx> <cy> <w> <h>
            with open(p, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    parts = line.split()
                    if parts:
                        classes.append(parts[0])
        elif ext == ".csv":
            with open(p, "r", encoding="utf-8", errors="replace") as f:
                header = f.readline().strip().split(",")
                cls_idx = -1
                for idx, col in enumerate(header):
                    if col.lower().strip() in {"class", "label", "name", "category", "classname"}:
                        cls_idx = idx
                        break
                if cls_idx >= 0:
                    for line in f:
                        row = line.strip().split(",")
                        if len(row) > cls_idx:
                            classes.append(row[cls_idx].strip())
    except Exception:
        pass
    return classes


def main():
    parser = argparse.ArgumentParser(description="Probe dataset structure, formats, and classes.")
    parser.add_argument("--root", type=str, required=True, help="Root path of the dataset.")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    out = OutputBuffer(max_lines=68)

    if not root.exists():
        out.print(f"ERROR: Dataset root '{root}' does not exist.")
        out.flush()
        sys.exit(1)

    out.print(f"=== IDD-FG / FGVD Dataset Probe: {root.name} ===")

    # 1. Bounded walk
    all_files, ext_counter, dir_ext_counts, split_dirs, total_walked = bounded_walk(root)
    out.print(f"Total entries walked: {total_walked} (capped at 50k)")

    # Extension histogram (top 10)
    top_exts = ext_counter.most_common(10)
    ext_str = ", ".join(f"{ext}: {cnt}" for ext, cnt in top_exts)
    out.print(f"Top extensions: {ext_str}")

    # Split directories
    if split_dirs:
        out.print(f"Split dirs found: {sorted(list(split_dirs))}")
    else:
        out.print("Split dirs found: None (no train/val/test subdirs detected at depth <= 2)")

    # Directory summary (top 2 levels)
    out.print("Directory summary (top-2-level dirs):")
    for dkey in sorted(dir_ext_counts.keys())[:8]:
        summary_str = " ".join(f"{ext}:{cnt}" for ext, cnt in dir_ext_counts[dkey].most_common(4))
        out.print(f"  {dkey:30s} -> {summary_str}")
    if len(dir_ext_counts) > 8:
        out.print(f"  [... {len(dir_ext_counts) - 8} more subdirectories ...]")

    # 2. Sample 3 annotation files
    anno_candidates = [p for p in all_files if is_annotation_candidate(p)]
    out.print(f"\nCandidate annotation files found: {len(anno_candidates)}")
    sample_annos = anno_candidates[:3]

    for idx, ap in enumerate(sample_annos, start=1):
        rel = ap.relative_to(root)
        out.print(f"--- Annotation sample {idx}: {rel} ---")
        head = sample_file_head(ap)
        for hline in head.splitlines()[:5]:  # compact display
            out.print(f"  {hline}")
        if len(head.splitlines()) > 5:
            out.print("  [...]")

    # 3. Class inventory from up to 200 annotation files
    class_counter: Counter = Counter()
    map_files: list[Path] = []

    # Look for classes.txt or mapping files
    for p in all_files:
        if p.name.lower() in {"classes.txt", "labels.txt", "names.txt"}:
            map_files.append(p)

    if anno_candidates:
        rng = random.Random(42)
        sample_pool = rng.sample(anno_candidates, min(200, len(anno_candidates)))
        for ap in sample_pool:
            clses = parse_classes_from_file(ap)
            for c in clses:
                class_counter[c] += 1

    out.print(f"\nClass name / ID inventory (from {min(200, len(anno_candidates))} sampled annotations, {sum(class_counter.values())} boxes):")
    if class_counter:
        top_classes = class_counter.most_common(25)
        for name, cnt in top_classes:
            out.print(f"  {name:30s}: {cnt}")
        if len(class_counter) > 25:
            out.print(f"  [... {len(class_counter) - 25} more classes ...]")
    else:
        out.print("  No classes detected from standard parser patterns.")

    # Print mapping file if found
    for mf in map_files[:1]:
        try:
            lines = [line.strip() for line in mf.read_text(encoding="utf-8", errors="replace").splitlines() if line.strip()]
            if len(lines) <= 60:
                out.print(f"\nClass map file found: {mf.relative_to(root)} ({len(lines)} lines):")
                out.print("  " + ", ".join(lines[:20]))
        except Exception:
            pass

    # 4. Image resolution stats (up to 10 images)
    img_candidates = [p for p in all_files if is_image_candidate(p)]
    if img_candidates and cv2 is not None:
        img_samples = img_candidates[:10]
        shapes = []
        for ip in img_samples:
            try:
                img = cv2.imread(str(ip))
                if img is not None:
                    h, w = img.shape[:2]
                    shapes.append((w, h))
            except Exception:
                pass
        shape_counts = Counter(shapes)
        res_str = ", ".join(f"{w}x{h}: {cnt}" for (w, h), cnt in shape_counts.most_common())
        out.print(f"\nImage resolution spread (sampled {len(shapes)} images): {res_str}")
    elif img_candidates:
        out.print(f"\nImage files found: {len(img_candidates)} (cv2 not available for dimension reading)")
    else:
        out.print("\nNo image candidates detected.")

    out.print("=== Probe Complete ===")
    out.flush()


if __name__ == "__main__":
    main()
