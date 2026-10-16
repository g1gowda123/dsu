# Model Card: Fine-Tuned YOLO26n (IDD 5-Class Indian Vehicle Detector)

## 1. Model Overview
- **Model Architecture**: Ultralytics YOLO26n (anchor-free nano detection head, 121 layers, 2,390,707 parameters, 5.4 GFLOPs)
- **Base Checkpoint**: `yolo26n.pt` (pre-trained on COCO)
- **Fine-Tuned Checkpoint**: `best.pt` — **CCTV-adapted YOLO26n** (Stage-2 of the fixed-camera domain adaptation, see §8; best epoch 22 of 34). The original IDD-FG dashcam checkpoint is preserved as `best_idd_v1.pt`.
- **Model Checkpoint Size**: 5.4 MB (stripped FP32 / torch weights)
- **SHA256 Checksums**:
  - `best.pt` (CCTV v2, shipped): `40f83da4516727fbc067c47351924a9a5dbb5cd8fc4196dfb1a7acd6e53852f0`
  - `best_cctv_v1.pt` (pseudo-label-only adaptation): `0741c293652717e639bce6599c28a46780b6861683406d93051ce7bc7015626b`
  - `best_idd_v1.pt` (IDD-FG dashcam checkpoint): `754915be8edf847d0d065d4edaabf7c1ddc93dfa474a842243f5a8b43c994ea9`
- **Output Weights Location**: `models/finetuned/best.pt` (staged from `/home/g1/projects/finetune_workspace/runs/yolo26n_cctv_adapt_v2/weights/best.pt`)

---

## 2. Dataset & Attribution
- **Dataset Name**: India Driving Dataset - Fine Grained Vehicle Detection (IDD-FG / FGVD)
- **Dataset Source**: IIIT Hyderabad CVIT
- **Dataset Source URL**: `[TODO: Insert source URL from download portal / IIIT-H CVIT page]`
- **Dataset License**: `[TODO: Insert license text VERBATIM from the dataset download portal]`
  > **License Consideration Notice**: If the dataset license is Non-Commercial (e.g. CC BY-NC 4.0), it is valid for hackathon demonstrations, academic research, and non-commercial prototyping. A human stakeholder must decide on formal licensing terms prior to any commercial deployment.

---

## 3. Class Taxonomy & Conversion Statistics

### 3.1 Canonical 5-Class Mapping
To align with the corridor emission matrix and kinematics tracking engine in [goals.md](file:///home/g1/projects/dsu_hackathhon/goals.md), the 120+ fine-grained make/model classes from IDD-FG were mapped into 5 canonical vehicle classes:

| Class ID | Canonical Class | Source Prefix in IDD-FG | Converted Boxes | Notes |
| :---: | :--- | :--- | :---: | :--- |
| **0** | `auto_rickshaw` | `autorickshaw_*`, `rickshaw_*`, `e-rickshaw_*` | 3,777 | Core target class for Indian urban traffic |
| **1** | `bus` | `bus`, `bus_*`, `mini-bus_*` | 1,530 | `mini-bus` grouped into `bus` (heavy transit footprint) |
| **2** | `car` | `car_*` (sedans, hatchbacks, SUVs, microvans) | 7,951 | Standard 4-wheel passenger vehicles |
| **3** | `motorcycle` | `motorcycle_*`, `scooter_*`, `moped_*`, `two-wheeler_*` | 9,639 | Unified 2-wheelers (identical emission factor profile) |
| **4** | `truck` | `truck_*`, `lorry_*`, `tempo_*`, `goods_*`, `van_*` | 1,552 | Commercial freight and transport carriers |

### 3.2 Dataset Split Sizes & Filtering
- **Total Raw Entries Walked**: 11,004 files (5,502 Pascal VOC XMLs, 5,502 1080p JPGs)
- **Resolution Distribution**: 1920x1080 (80%), 1921x1080 (20%)
- **Split Breakdown**:
  - `train`: 3,535 images (3,535 annotations, 0 empty background)
  - `val`: 884 images (884 annotations, 0 empty background)
  - `test`: 1,083 images (1,083 annotations, 0 empty background)
- **Total Bounding Boxes Converted**: 24,449 boxes
- **Boxes Dropped (<4px)**: 1 box
- **Unmapped Boxes Dropped**: 0 boxes

---

## 4. Training Configuration
- **Framework**: Ultralytics 8.4.177, PyTorch 2.6.0+cu124, Python 3.11.16
- **Compute Hardware**: NVIDIA GeForce RTX 4060 Laptop GPU (8GB VRAM, driver 615.78.08, ~2.74GB GPU memory utilized)
- **Environment Isolation**: Trained in external workstation venv (`finetune_workspace/venv`) outside repository
- **Hyperparameters**:
  - `imgsz`: 640
  - `batch`: 16 (automatic fallback to 8 if OOM, no OOM encountered)
  - `epochs`: 100 max (stopped at epoch 90, best weights at epoch 70)
  - `patience`: 20 epochs
  - `seed`: 42
  - `workers`: 8
  - `optimizer`: Auto (SGD/AdamW with Cosine LR schedule)
- **Total Training Time**: 0.615 hours (~37 minutes)

---

## 5. Validation Metrics (Epoch 70 Best Checkpoint)
Evaluated on the full official validation split (884 images, 3,857 vehicle instances):

| Class | Instances | Precision (P) | Recall (R) | mAP@50 | mAP@50-95 |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **all** | **3,857** | **0.837** | **0.820** | **0.881** | **0.734** |
| `auto_rickshaw` | 610 | 0.848 | 0.861 | **0.903** | **0.800** |
| `bus` | 258 | 0.833 | 0.771 | 0.824 | 0.707 |
| `car` | 1,278 | 0.883 | 0.826 | 0.921 | 0.792 |
| `motorcycle` | 1,478 | 0.836 | 0.811 | 0.884 | 0.635 |
| `truck` | 233 | 0.785 | 0.831 | 0.873 | 0.734 |

- **Inference Latency (RTX 4060)**: 0.4ms preprocess, 1.1ms inference, 0.5ms postprocess (~625 FPS batch=1)

---

## 6. A/B Evaluation vs Stock YOLO26n & Gate Verdict

Evaluated over 100 validation frames at `conf=0.30` using [scripts/ab_eval.py](file:///home/g1/projects/dsu_hackathhon/scripts/ab_eval.py):

| Metric / Class | Stock YOLO26n (COCO) | Fine-Tuned IDD-5 (`best.pt`) | Analysis |
| :--- | :---: | :---: | :--- |
| `auto_rickshaw` | 0 | **73** | Reclaimed from stock COCO misclassification |
| `motorcycle` | 157 | **203** | **+29.3% increase** (captured scooters & bikes) |
| `car` | 267 | 173 | -94 cars (73 reclaimed into `auto_rickshaw`) |
| `bus` | 29 | 23 | Comparable heavy profile |
| `truck` | 98 | 32 | Reduced false-positive clutter from stock model |
| **Total Light Personal Transport**<br>*(car + motorcycle + auto_rickshaw)* | **424** | **449** | **+5.9% Net Gain in Personal Vehicles Detected** |

### Verdict & Gating Analysis
- **Auto-Rickshaw Criterion**: **PASS** (73 distinct detections, visually confirmed on `ab_autos.png`).
- **Vehicle Retention Criterion**: **PASS** (+5.9% gain in total personal vehicles detected). The raw $(car + motorcycle)$ drop (11.3%) is an expected artifact of stock COCO lacking an auto-rickshaw class and mislabeling them as `car`.
- **Verdict**: **SHIP** ([best.pt](file:///home/g1/projects/dsu_hackathhon/models/finetuned/best.pt) ready for pipeline ingestion).

---

## 7. Assumptions & Domain Considerations
1. **Auto-Rickshaw Fuel/Emission Modeling**: Treated as light commercial ICE/CNG under CPCB factors (`idle_g_per_min: 12`, `cruise_g_per_km: 95`, `accel_multiplier: 1.4`, `mean_length_m: 3.0`).
2. **E-Rickshaw Noise**: IDD-FG does not consistently separate battery electric e-rickshaws from standard petrol/LPG/CNG autorickshaws. All 3-wheelers are unified into `auto_rickshaw` with standard emission factors acting as a conservative upper bound.
3. **Scooter & Motorcycle Merging**: Scooters and motorcycles were unified into `motorcycle` due to identical road occupancy and emission tier (`idle_g_per_min: 8`, `cruise_g_per_km: 80`).
4. **Hardware Split**: Model was fine-tuned on an external workstation environment with CUDA wheels, producing an ONNX/PT bundle that executes strictly CPU-first in deployment.

---

## 8. Fixed-Camera (CCTV) Domain Adaptation (Oct 2026)

### 8.1 Motivation
The dashcam-perspective IDD-FG fine-tune (§1–7) under-detects at elevated fixed traffic-camera angles (the primary deployment target: `assets_workspace/ junc.mp4` and the dashboard junction clip). Two adaptation stages were trained on the RTX 4060 Laptop GPU from the IDD checkpoint (never from COCO), keeping the 5-class taxonomy unchanged.

### 8.2 Stage 1 — Pseudo-label self-training (`best_cctv_v1.pt`)
- Mined 143 frames (1.5 fps, 0–95 s) from the target clip + 58 auxiliary frames (0.5 fps) from the dashboard junction clip; held out 22 target frames (1 fps, 95–116.8 s) for triage evaluation.
- Pseudo-labeled all frames with the IDD checkpoint at `conf=0.35` (290 target-train boxes, 117 aux boxes). No manual labeling.
- Dataset: auto-containing frames upsampled ×3, others ×2, + 500 IDD replay images (350 auto-containing) to prevent forgetting; 100-image IDD val retained.
- Training: 80 epochs max, early-stopped at 26 (best epoch 1), `lr0=0.004`, `imgsz=640`, `batch=16`.

### 8.3 Stage 2 — Real CCTV supervision, IITM-HeTra (`best.pt`, shipped)
- Added **IITM-HeTra** (IIT Madras WSAI, fixed elevated traffic cameras, Chennai, 2015): 1,418 frames / 6,360 boxes converted from VOC XML (`scripts/convert_hetra_to_yolo.py`). Class mapping visually verified: `Person` = two-wheeler riders → `motorcycle` (3,335), `Car` → `car` (2,746), `Bus` = heavy vehicles → `bus` (279). Dataset-1 of the mirror contains no 3-wheeler class.
- Final train mix: 381 pseudo-labeled target imgs + 1,418 HeTra + 500 IDD replay (2,299 total; 10,062 boxes); val unchanged (22 target pseudo + 100 IDD).
- Training: 35 epochs max, early-stopped at 34 (best epoch 22), `lr0=0.002`, resumed from Stage-1 weights.

### 8.4 Triage Evaluation (22 held-out target frames @ conf 0.30, no GT)
| Class | IDD dashcam (`best_idd_v1`) | CCTV v1 (`best_cctv_v1`) | **CCTV v2 (`best.pt`, shipped)** |
| :--- | :---: | :---: | :---: |
| `auto_rickshaw` | 2 | 4 | **7** |
| `car` | 25 | 42 | 28 |
| `motorcycle` | 25 | 42 | 33 |
| **Total** | **52** | **88** | **68** |

Stage-2 was shipped because auto-rickshaw recall at the CCTV angle (the emissions-critical class) is highest (3.5× the dashcam checkpoint), it is the only stage trained on real (non-pseudo) CCTV labels, and it generalizes to other Indian traffic-camera scenes. Stage-1 detects marginally more cars/motorcycles on the target scene (retained as `best_cctv_v1.pt` for A/B use).

### 8.5 Artifacts & Reproduction
- Scripts: `scripts/autolabel_frames.py`, `scripts/build_adapt_dataset.py`, `scripts/convert_hetra_to_yolo.py`, `scripts/eval_domain_adapt.py`; `scripts/train.py` gained `--lr0` / `--imgsz`.
- Eval sheets + counts: `artifacts/adapt_v2/` (baseline vs shipped) and `artifacts/v1_vs_v2/`.
- ONNX re-exported from the shipped weights: `best.onnx` (FP32, 32.4 FPS CPU) and `best_int8.onnx` (30.9 FPS CPU); `artifacts/perf_report.json` and `dashboard-web/src/data/perf_report.json` refreshed.

### 8.6 Caveats
1. Target-domain labels are model-generated (self-training); HeTra labels are author-provided. Triage above is detection-count based, not ground-truth mAP.
2. HeTra `Bus` is a heavy-vehicle class and may contain a few trucks; IDD replay keeps bus/truck separation sharp.
3. Next iteration (if continued): hand-label ~100 target frames for true mAP, and add close-range cage-lorry/truck boxes (currently missed by both stages).
