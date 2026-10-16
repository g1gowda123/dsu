#!/usr/bin/env python3
"""Fine-tune vehicle detector on IDD 5-class vehicle dataset using Ultralytics API.

Timebox: 4h GPU max — take best checkpoint if patience doesn't trigger.
If yolo26 training crashes twice on this ultralytics version → do NOT silently switch;
report and propose yolo11n as a documented fallback decision.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys
import torch
from ultralytics import YOLO


def train_model(
    base_model: str = "yolo26n.pt",
    data_yaml: str = "models/finetuned/data.yaml",
    imgsz: int = 640,
    epochs: int = 100,
    patience: int = 20,
    batch: int = 16,
    seed: int = 42,
    device: int | str = 0,
    workers: int = 8,
    lr0: float = 0.01,
    project: str = "/home/g1/projects/finetune_workspace/runs",
    name: str = "yolo26n_idd5",
):
    data_path = Path(data_yaml).resolve()
    if not data_path.is_file():
        print(f"ERROR: data.yaml not found at {data_path}")
        sys.exit(1)

    # Prefer local base weights if present in cwd
    local_base = Path(base_model)
    if not local_base.is_file() and Path("yolo26n.pt").is_file() and base_model == "yolo26n.pt":
        base_model = str(Path("yolo26n.pt").resolve())

    print(f"=== Starting Fine-Tuning Pipeline ===")
    print(f"Base model : {base_model}")
    print(f"Dataset    : {data_path}")
    print(f"Device     : {device} ({torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'})")
    print(f"Image size : {imgsz}")
    print(f"Batch size : {batch} (auto-fallback to 8 on OOM)")
    print(f"LR0        : {lr0}")
    print(f"Epochs     : {epochs} (patience={patience})")
    print(f"Workers    : {workers}")
    print(f"Project dir: {project}")

    Path(project).mkdir(parents=True, exist_ok=True)

    model = YOLO(base_model)

    current_batch = batch
    results = None

    try:
        results = model.train(
            data=str(data_path),
            imgsz=imgsz,
            epochs=epochs,
            patience=patience,
            batch=current_batch,
            lr0=lr0,
            seed=seed,
            device=device,
            workers=workers,
            project=project,
            name=name,
            exist_ok=True,
            plots=True,
            save=True,
            val=True,
        )
    except (torch.cuda.OutOfMemoryError, RuntimeError) as e:
        err_msg = str(e).lower()
        if "out of memory" in err_msg or "cuda" in err_msg:
            print(f"\n[WARNING] CUDA Out of Memory with batch={current_batch}. Attempting auto-fallback to batch=8...")
            torch.cuda.empty_cache()
            current_batch = 8
            # Re-instantiate model
            model = YOLO(base_model)
            results = model.train(
                data=str(data_path),
                imgsz=imgsz,
                epochs=epochs,
                patience=patience,
                batch=current_batch,
                lr0=lr0,
                seed=seed,
                device=device,
                workers=workers,
                project=project,
                name=name,
                exist_ok=True,
                plots=True,
                save=True,
                val=True,
            )
        else:
            raise

    # Locate and report best checkpoint
    save_dir = Path(model.trainer.save_dir) if hasattr(model, "trainer") and model.trainer else Path(project) / name
    best_pt = save_dir / "weights" / "best.pt"

    print("\n=== Training Completed ===")
    if best_pt.exists():
        print(f"BEST_WEIGHTS_PATH: {best_pt.resolve()}")
    else:
        print(f"Weights dir: {save_dir / 'weights'}")

    return results, best_pt


def main():
    parser = argparse.ArgumentParser(description="Fine-tune YOLO model on IDD 5-class dataset.")
    parser.add_argument("--base", type=str, default="yolo26n.pt", help="Base model weights.")
    parser.add_argument("--data", type=str, default="models/finetuned/data.yaml", help="Path to data.yaml.")
    parser.add_argument("--epochs", type=int, default=100, help="Max training epochs.")
    parser.add_argument("--patience", type=int, default=20, help="Early stopping patience.")
    parser.add_argument("--batch", type=int, default=16, help="Batch size (auto-fallback to 8 on OOM).")
    parser.add_argument("--imgsz", type=int, default=640, help="Training image size.")
    parser.add_argument("--lr0", type=float, default=0.01,
                        help="Initial LR. Use ~0.004 for gentle domain adaptation from a fine-tuned base.")
    parser.add_argument("--device", default=0, help="CUDA device index or 'cpu'.")
    parser.add_argument("--workers", type=int, default=8, help="DataLoader workers.")
    parser.add_argument("--project", type=str, default="/home/g1/projects/finetune_workspace/runs",
                        help="Runs output directory.")
    parser.add_argument("--name", type=str, default="yolo26n_idd5", help="Run experiment name.")

    args = parser.parse_args()

    train_model(
        base_model=args.base,
        data_yaml=args.data,
        imgsz=args.imgsz,
        epochs=args.epochs,
        patience=args.patience,
        batch=args.batch,
        lr0=args.lr0,
        device=args.device,
        workers=args.workers,
        project=args.project,
        name=args.name,
    )


if __name__ == "__main__":
    main()
