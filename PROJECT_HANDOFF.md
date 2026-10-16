# Project Handoff & Technical Status Report
**Project:** Eco-Kinetic Traffic Carbon Digital Twin  
**Hackathon:** DSU Code Clash — Track 05: Carbon Footprint Intelligence Platform  
**Architecture Paradigm:** Lightweight Edge CCTV Retrofit • CPU-First Deployment • Zero-PII Telemetry Uplink • Deterministic Carbon Engine + Schema-Constrained LLM Dispatcher  

---

## 1. Executive Summary & System Architecture

This project retrofits existing municipal CCTV traffic camera fleets into a real-time carbon intelligence system without requiring new physical hardware or video streaming over the WAN. 

```
                                      +---------------------------------------------+
                                      |             EDGE JUNCTION BOX               |
                                      |                                             |
[ Existing CCTV Fleet ]               |  +---------------------------------------+  |
       │                              |  | 1. Perception & Tracking (CPU)        |  |
       ▼ (RTSP / Local Video)         |  |    - Fine-tuned YOLO (IDD-5 classes)   |  |
+---------------------+               |  |    - ByteTrack tracking               |  |
| 1080p/720p 30 FPS   | ─────────────►|  +---------------------------------------+  |
+---------------------+               |                       │                     |
                                      |                       ▼                     |
                                      |  +---------------------------------------+  |
                                      |  | 2. Kinematics State Machine           |  |
                                      |  |    - Length-calibrated speed proxy    |  |
                                      |  |    - EMA smoothing (alpha=0.3)        |  |
                                      |  |    - States: IDLE, ACCEL, CRUISE,     |  |
                                      |  |      DECEL (gated at >= 15 frames)    |  |
                                      |  +---------------------------------------+  |
                                      |                       │                     |
                                      |                       ▼                     |
                                      |  +---------------------------------------+  |
                                      |  | 3. Deterministic Carbon Twin Engine   |  |
                                      |  |    - CPCB/BS-VI factor lookup         |  |
                                      |  |    - Cumulative grams CO2 / vehicle   |  |
                                      |  |    - 60s Corridor Aggregation         |  |
                                      |  |    - 4x4 Spatial Choke Grid Ranking   |  |
                                      |  +---------------------------------------+  |
                                      +-----------------------┬---------------------+
                                                              │
                                    Telemetry-Only Uplink (JSON / Parquet)
                                    [NO VIDEO EGRESS / NO PII]
                                                              │
                                                              ▼
                                      +---------------------------------------------+
                                      |       ICCC / MUNICIPAL OPERATIONS           |
                                      |                                             |
                                      |  +---------------------------------------+  |
                                      |  | 4. GenAI Municipal Dispatcher         |  |
                                      |  |    - Schema-constrained advisory      |  |
                                      |  |    - Signal timing & corridor policy  |  |
                                      |  |    - Deterministic CO2 savings inject |  |
                                      |  |    - Automatic rules fallback         |  |
                                      |  +---------------------------------------+  |
                                      |                       │                     |
                                      |                       ▼                     |
                                      |  +---------------------------------------+  |
                                      |  | 5. Streamlit Command Dashboard        |  |
                                      |  |    - Real-time KPIs & Choke Matrix    |  |
                                      |  |    - Synced overlay video player      |  |
                                      |  |    - What-If counterfactual simulator |  |
                                      |  +---------------------------------------+  |
                                      +---------------------------------------------+
```

---

## 2. What Is DONE (Completed Milestones & Assets)

### ✅ M0 — Scaffolding, Environment & Edge CPU Constraints
- **Zero-CUDA Edge Thesis:** Confirmed CPU-only environment (`torch==2.14.1+cpu`, `torchvision==0.29.1+cpu`), with `--extra-index-url https://download.pytorch.org/whl/cpu` pinned in `requirements.txt`. Zero `nvidia-*` wheels installed.
- **Config Management:** Fully parameterised YAML configuration files:
  - `config/app.yaml`: Active classes (`car`, `motorcycle`, `auto_rickshaw`, `bus`, `truck`), `frame_skip=2`, `imgsz=640`, confidence, kinematic thresholds, and camera settings.
  - `config/emission_factors.yaml`: CPCB/EPA BS-VI empirical emission matrix (`idle_g_per_min`, `cruise_g_per_km`, `accel_multiplier`, `mean_length_m`) with citations.
  - `config/camera_calibration.yaml`: Calibration zones and homography placeholders.
- **Video Dataset Audition:** Audited candidate clips (`assets_workspace/candidates/`) for Indian intersection dynamics, auto-rickshaw density, and stationary CCTV perspective. Selected junction video saved at `assets_workspace/junction.mp4`.

### ✅ M-T — Fine-Tuning & 5-Class Indian Road Taxonomy
- **Dataset Preparation:** Converted India Driving Dataset (IDD-FGVD) annotations into YOLO format using `scripts/convert_to_yolo.py`.
- **Model Training & Distribution:** Fine-tuned `yolo26n` on IDD to produce a custom 5-class detector:
  - Model path: `models/finetuned/best.pt` (and lightweight base weights `yolo26n.pt`).
  - Active classes: `car`, `motorcycle`, `auto_rickshaw`, `bus`, `truck`.
  - ONNX Exports: `models/finetuned/best.onnx` (FP32, 43.29 FPS) and `models/finetuned/best_int8.onnx` (INT8 quantized, 33.12 FPS).
- **A/B Evaluation & Gate Validation:** `scripts/ab_eval.py` executed to verify auto-rickshaw detection retention while safeguarding light vehicle recall. Auto-rickshaw detection contact sheet generated (`ab_autos.png`).
- **Model Governance:** Detailed technical documentation committed in `docs/model_card.md` and `docs/data_provenance.md`.

### ✅ M1 — Perception & Kinematics Pipeline
- **Detector & Tracker:** `perception/detector.py` and `perception/tracker.py` integrate Ultralytics YOLO with ByteTrack (`bytetrack.yaml`), dynamically mapping class IDs (`model.names ∩ active_classes`).
- **Kinematic State Engine:** `perception/kinematics.py`:
  - Speed proxy: Centroid displacement normalised by bounding box width, converted to km/h via class-specific mean vehicle lengths.
  - Exponential moving average (EMA $\alpha=0.3$) for noise rejection.
  - 4-state state machine: `IDLE` ($v < 2\text{ km/h}$ for $> 3\text{ s}$ after motion), `ACCEL`, `CRUISE` ($15\text{--}50\text{ km/h}$), `DECEL`.
  - Gated at track age $\ge 15\text{ frames}$ to prevent tracking churn noise.
- **Pipeline Execution Script:** `scripts/run_pipeline.py` processes video and outputs `telemetry.parquet` and `telemetry_meta.json`.
- **Synthetic Telemetry Generator:** `scripts/make_synthetic_telemetry.py` creates robust deterministic synthetic telemetry datasets (`artifacts/telemetry_synthetic.parquet`) for testing without heavy video dependencies.

### ✅ M2 — Twin Carbon Engine & Corridor Aggregations
- **Emission Engine:** `twin/emission_engine.py` implements mode-bin emission accumulation (g CO2) based strictly on kinematic state and class parameters.
- **Corridor Analytics:** `twin/corridor.py`:
  - 60-second sliding window corridor roll-ups (total kg CO2, idle share %, heavy stop events).
  - 4x4 spatial grid decomposition with cell ID ranking to highlight thermal choke zones.
  - Append-only event extractor (`events.jsonl`).
  - Strict payload generation function `to_dispatcher_payload(...)` ready for Teammate D / Dispatcher consumption.

### ✅ M3 — Visual Overlay Video
- **Renderer Script:** `scripts/render_overlay.py` burns state-coloured bounding boxes (Green=CRUISE, Amber=ACCEL, Red=IDLE, Blue=DECEL), track IDs, class tags, and cumulative grams CO2 directly into video.
- **Artifact:** Generated and committed `artifacts/overlay.mp4`.

### ✅ M4 & M5 — Streamlit Command Dashboard & What-If Twin
- **Dashboard Application:** `dashboard/app.py`:
  - 5-KPI metric cards: *Vehicles Tracked*, *Cumulative CO2*, *Idle Share %*, *Stop Events*, *Top Choke Zone*.
  - Synced playback: Time window scrub slider coupled with video playback and kinematic activity bar charts.
  - 4x4 spatial choke-point ranking table.
  - Directive feed UI with LLM and rules-fallback visual badges.
  - Methodology sidebar with full factor transparency and assumptions.
- **Counterfactual Policy Simulator (`twin/scenarios.py`):**
  - Instantaneous vectorized re-computation (< 1 second response).
  - Individual sliders for fleet electrification (EV share 0–100% for car, motorcycle, auto_rickshaw, bus, truck).
  - Signal policy toggles: Adaptive green extension (0–15s) and Heavy Vehicle priority corridor.
  - Outputs baseline vs. scenario CO2, avoided CO2, percentage abatement, and class-by-class audit table.

### ✅ M7 (Partial) — Edge Benchmarking & Deployment Architecture
- **Benchmarking Suite:** `scripts/benchmark.py` outputs `artifacts/perf_report.json`:
  - Model size: 5.19 MB
  - CPU FPS: 28.47 FPS (PyTorch CPU) / 43.29 FPS (ONNX FP32)
  - Memory: 1.75 MB peak RAM footprint
  - Telemetry bandwidth: ~30.9 KB/min (ultra-low bandwidth telemetry uplink)
- **Deployment Documentation:** `docs/deployment.md` covering ICCC integration, ATCS tie-ins, edge hardware BOM, and privacy architecture.

### ✅ Test Suite Health
- **27/27 Golden Path Tests Passing** (`.venv/bin/pytest -q`):
  - `tests/test_placeholder.py`: Config schemas & keys verification.
  - `tests/test_probe.py`: Video codec, FPS, and dimension checks.
  - `tests/test_convert_to_yolo.py`: IDD dataset bounding box conversion tests.
  - `tests/test_kinematics.py`: Synthetic vehicle stopped/accelerating state transition tests.
  - `tests/test_twin.py`: Emission accumulation (±5% golden hand calculations), corridor aggregator, and dispatcher payload schema tests.
  - `tests/test_dashboard_and_benchmark.py`: Benchmark JSON schema and dashboard loading verification.

---

## 3. What HAS TO BE DONE (Pending Tasks & Open Gaps)

### 🔴 Priority 1: Milestone M6 — GenAI Dispatcher Module (`dispatcher/`)
*Currently `dispatcher/` contains only `__init__.py`. This is the major architectural component left to implement.*

1. **`dispatcher/schema.py`:**
   - Define Pydantic models matching Section 6 of `goals.md`:
     ```python
     class ActionType(str, Enum):
         EXTEND_GREEN = "extend_green"
         GREEN_WAVE_PRIORITY = "green_wave_priority"
         HEAVY_VEHICLE_RESTRICTION = "heavy_vehicle_restriction"
         NO_ACTION = "no_action"

     class Action(BaseModel):
         type: ActionType
         lane: Optional[Literal["N", "S", "E", "W"]] = None
         seconds: Optional[int] = Field(None, ge=0, le=15)
         target_class: Optional[Literal["car", "motorcycle", "auto_rickshaw", "bus", "truck"]] = None

     class Directive(BaseModel):
         timestamp: str
         intersection_id: str
         actions: List[Action]
         estimated_co2_saved_g: float  # Injected in Python; never LLM
         confidence: float = Field(..., ge=0.0, le=1.0)
         rationale: str = Field(..., max_length=300)
         mode: Literal["llm", "rules_fallback"]
     ```
2. **`dispatcher/rules_fallback.py`:**
   - Deterministic rule engine for offline or quota-exceeded modes:
     - If `top_choke_zone.idle_vehicle_minutes > 5.0` or `idle_ratio > 0.40`: trigger `extend_green` on congested axis for 8–12 seconds.
     - If `heavy_vehicle_density > 0.15` and stop events high: trigger `heavy_vehicle_restriction` or `green_wave_priority` for 10 seconds on `bus`/`truck`.
     - Otherwise: return `no_action`.
     - Calculate `estimated_co2_saved_g` deterministically based on avoided idle duration $\times$ idle emission factor.
     - Set `mode="rules_fallback"`, `confidence=0.85`.
3. **`dispatcher/llm_dispatcher.py`:**
   - Integrates with Gemini / OpenAI / LiteLLM (using API key from `.env`).
   - Guardrail rule: **NEVER let LLM compute emissions**. Prompt passes corridor telemetry payload and instructs model to pick actions and concise rationales ($\le 300$ chars).
   - Validation retry: 1 retry if schema validation fails; fall back to `rules_fallback` on error.
   - Inject post-validation Python-calculated `estimated_co2_saved_g`.
   - Append directive record to `artifacts/directives.jsonl`.
4. **`tests/test_dispatcher.py`:**
   - Test 20 synthetic/mock corridor payloads.
   - Test offline mode when API key is unset $\rightarrow$ asserts `mode == "rules_fallback"` and 100% schema valid.
   - Test that LLM responses with corrupted schemas fall back gracefully.

---

### 🟡 Priority 2: End-to-End Pipeline Run on Junction Video
- Currently, tests and dashboard use synthetic telemetry fixture fallback (`telemetry_synthetic.parquet`).
- Run `scripts/run_pipeline.py` on the verified video `assets_workspace/junction.mp4`:
  - Produce real `artifacts/telemetry.parquet` (60s+ duration).
  - Verify `telemetry.parquet` contains realistic distributions of auto-rickshaws, bikes, and cars.
  - Run `twin/corridor.py` over the live telemetry to populate `artifacts/events.jsonl` and trigger initial directives into `artifacts/directives.jsonl`.

---

### 🟡 Priority 3: README & Documentation Polish (M7 Requirement)
- Replace the skeleton `README.md` with:
  - System architecture diagram (Mermaid).
  - Setup and execution instructions:
    ```bash
    # Install dependencies (CPU PyTorch)
    pip install -r requirements.txt
    
    # Run test suite
    pytest -q
    
    # Run perception pipeline
    python scripts/run_pipeline.py --video assets_workspace/junction.mp4
    
    # Launch Streamlit dashboard
    streamlit run dashboard/app.py
    ```
  - Deployment topology (Edge Box $\rightarrow$ Telemetry $\rightarrow$ ICCC).
  - CPCB / ARAI emission factor citations and mathematical equations.
  - Strict Privacy Policy statement (Zero PII, no ANPR, edge processing).
  - Known limitations (e.g. COCO auto-rickshaw gap vs. custom fine-tuned IDD-5 weights).

---

### 🟢 Priority 4: Milestone M8 — Demo Video Recording & Git Release Freeze
- **Demo Backup Video:** Record a 2–3 minute video recording (`artifacts/demo_backup.mp4`) demonstrating:
  - Dashboard overview and live metric cards.
  - Video overlay playback with dynamic state tracking.
  - What-If counterfactual scenario slider adjustments showing live carbon abatement.
  - Real-time municipal dispatcher directive stream with both LLM and fallback badges.
- **Git Tag:** Create tag `demo-v1` at freeze hour.

---

## 4. Key Constraints & Guardrails to Pass to the Next LLM

When handing off this project to another LLM, enforce the following non-negotiable rules:
1. **CPU-First Dev & Deploy:** Never install CUDA torch packages or `nvidia-*` libraries in this repository. All PyTorch calls must pass `device="cpu"`.
2. **Deterministic Carbon Calculation:** The LLM dispatcher must NEVER calculate carbon figures or fuel savings. All mathematics must be calculated in Python using `config/emission_factors.yaml`.
3. **Strict Privacy by Design:** Never introduce license plate recognition (ANPR), facial recognition, or video upload APIs. Only numerical telemetry (bounding box coordinates, class, speed, state) leaves the processing boundary.
4. **Zero Unapproved Dependencies:** Do not add arbitrary new packages to `requirements.txt` without necessity. Standard packages (`pydantic`, `google-generativeai` or `litellm`, `pandas`, `numpy`, `streamlit`) are already present in `.venv`.
5. **Always Run Tests with Virtualenv Python:** Use `.venv/bin/pytest -q` or ensure virtualenv is activated; system Python does not have project dependencies installed.

---

## 5. File & Directory Reference Map

| Path | Status | Purpose |
|---|---|---|
| `config/app.yaml` | Complete | Master application configuration, class map, thresholds |
| `config/emission_factors.yaml` | Complete | CPCB/EPA BS-VI empirical vehicle emission parameters |
| `config/camera_calibration.yaml` | Complete | Camera zone polygons and homography schema |
| `models/finetuned/best.pt` | Complete | Custom IDD-trained 5-class YOLO vehicle detector |
| `models/finetuned/best.onnx` | Complete | FP32 ONNX export for lightweight edge inference |
| `models/finetuned/best_int8.onnx` | Complete | INT8 quantized ONNX model |
| `perception/detector.py` | Complete | NMS-free YOLO inference with active class filtering |
| `perception/tracker.py` | Complete | ByteTrack tracker wrapper |
| `perception/kinematics.py` | Complete | Speed proxy, EMA smoothing, 4-state kinematic classifier |
| `twin/emission_engine.py` | Complete | Mode-bin CO2 emission accumulator |
| `twin/corridor.py` | Complete | 60s window rollups, 4x4 choke points, dispatcher payload |
| `twin/scenarios.py` | Complete | Counterfactual policy engine (EV mix, green extension) |
| `dispatcher/schema.py` | **Pending** | Pydantic contracts for actions, directives, payloads |
| `dispatcher/rules_fallback.py` | **Pending** | Deterministic rule-based dispatcher fallback |
| `dispatcher/llm_dispatcher.py` | **Pending** | Schema-constrained LLM client + Python CO2 inject |
| `dashboard/app.py` | Complete | Streamlit command UI & what-if simulator |
| `scripts/run_pipeline.py` | Complete | Video $\rightarrow$ tracking $\rightarrow$ kinematics $\rightarrow$ `telemetry.parquet` |
| `scripts/render_overlay.py` | Complete | Video annotator with state colors and CO2 values |
| `scripts/benchmark.py` | Complete | Measures CPU FPS, memory, telemetry bandwidth |
| `docs/deployment.md` | Complete | One-pager edge deployment & ICCC integration doc |
| `docs/model_card.md` | Complete | Technical card for fine-tuned IDD vehicle detector |
| `README.md` | **Pending Expansion** | Complete project readme with architecture & run steps |
| `artifacts/perf_report.json` | Complete | Measured benchmark numbers |
| `artifacts/overlay.mp4` | Complete | Sample state-overlay video |
| `artifacts/directives.jsonl` | **Pending** | Append-only municipal directives log |
| `artifacts/demo_backup.mp4` | **Pending** | 2-3 minute backup video recording |
