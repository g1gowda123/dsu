# Data Provenance: Indian Urban Intersection Demo Asset (`junction.mp4`)

## 1. Primary Source Attribution
- **Source Video Title**: `CRAZY INDIAN TRAFFIC CONGESTION`
- **Original Source URL**: [https://www.youtube.com/watch?v=iEIk3RpV6RA](https://www.youtube.com/watch?v=iEIk3RpV6RA)
- **Content Creator / Uploader**: **Sound Spirit** ([Channel URL](https://www.youtube.com/channel/UCIgbZQ06EEubii3ds6mZn6A))
- **Filming Location**: New Delhi, India (Urban Intersection / Thoroughfare)
- **Filming Date**: February 2012
- **Original Media Format**:
  - Resolution: 1920x1080 (1080p Full HD)
  - Frame Rate: 25.0 fps progressive
  - Duration: 96.5 seconds (2,412 frames)
  - Video Codec: H.264 (AVC)
  - Audio Codec: AAC stereo (44.1 kHz)

---

## 2. Licensing Terms & Rights Summary
- **Declared License**: **Creative Commons Attribution (reuse allowed)** (YouTube standard CC-BY license).
- **Applicable Legal Code**: [Creative Commons Attribution 3.0 Unported (CC BY 3.0)](https://creativecommons.org/licenses/by/3.0/) / [CC BY 4.0 International](https://creativecommons.org/licenses/by/4.0/)
- **License Verbatim Summary**:
  > *"You are free to:*
  > - ***Share*** *— copy and redistribute the material in any medium or format*
  > - ***Adapt*** *— remix, transform, and build upon the material for any purpose, even commercially.*
  > 
  > *Under the following terms:*
  > - ***Attribution*** *— You must give appropriate credit, provide a link to the license, and indicate if changes were made. You may do so in any reasonable manner, but not in any way that suggests the licensor endorses you or your use."*
- **Commercial & Hackathon Rights**: Fully compliant with hackathon evaluation, public demonstration, derivative transcoding, and prototype analytics. No non-commercial (NC) or share-alike (SA) restrictions were attached by the uploader.

---

## 3. Audition Process & Selection Rationale

Three distinct candidates were downloaded, inspected, and auditioned via `assets_workspace/tools/audition_clips.py` using the repository's fine-tuned model (`models/finetuned/best.pt`) on CPU at `conf=0.30`:

### Audition Comparison Table
| Candidate | Source Location | Resolution | FPS | Duration | Mean Veh/Fr | Autos/Fr | Motos/Fr | Heavy % | Brightness | Verdict |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Candidate 1 (Winner)** | New Delhi Intersection (`iEIk3RpV6RA`) | **1920x1080** | **25.0** | **96.5s** | **2.33** (peaks: 11) | **0.17** | **1.27** | **30.0%** | **98.2** | **SELECTED** |
| **Candidate 2** | Ludhiana Overpass (`av4txy2jYCI`) | 1920x1080 | 30.0 | 267.0s | 3.30 | 0.23 | 2.17 | 20.0% | 138.4 | Disqualified (sidewalk angle, empty foreground) |
| **Candidate 3** | Tank Bund Hyderabad (`WdFFCCUi0-8`) | 1920x1080 | 30.0 | 100.2s | 1.37 | 0.07 | 0.77 | 10.0% | 122.7 | Disqualified (moving camera POV, lake corridor) |

### Winner Selection Justification
Candidate 1 was selected because it uniquely satisfies all operational criteria for the Eco-Kinetic Traffic Carbon Digital Twin:
1. **Fixed Camera CCTV Angle**: Mounted at an elevated viewpoint overlooking the roadway and conflict zone, mimicking actual municipal surveillance/enforcement camera installations.
2. **Dense Multi-Modal Indian Roadway**: Captures high modal diversity including auto-rickshaws, motorcycles/scooters, passenger cars, delivery vans/tempos, cycle-rickshaws, and mini-trucks.
3. **Pronounced Stop-and-Go Dynamics**: Features authentic deceleration, queueing at an un-signalized/congested choke point, prolonged vehicle idling, and acceleration cycles, directly exercising the kinematic 4-state engine (IDLE, ACCEL, CRUISE, DECEL).
4. **Native Frame Rate & Lighting**: Native 25.0 fps requires no frame interpolation; clear daytime daylight (luma 98.2) ensures high detection confidence without low-light artifacts.

---

## 4. Normalization Pipeline & Edits Performed

Immediately following selection, Candidate 1 was normalized to standard production specifications:

```bash
ffmpeg -i assets_workspace/candidates/candidate_1_delhi.mp4 \
  -vf "scale=-2:720,fps=25" \
  -t 110 \
  -c:v libx264 \
  -crf 23 \
  -y assets_workspace/junction.mp4
```

### Transformation Specifications:
- **Spatial Rescaling**: Scaled from 1080p (1920x1080) to 720p (1280x720) with aspect ratio preserved (`scale=-2:720`).
- **Temporal Enforcement**: Pinned to constant 25.0 fps (`fps=25`).
- **Duration**: Full active clip duration normalized within the 90–120s specification window (96.48 seconds, 2,412 frames).
- **Encoding**: Video re-encoded with `libx264` at visually lossless CRF 23; audio re-encoded to AAC stereo 44.1 kHz.
- **Delivery Destination**: Staged to `data/videos/junction.mp4` (gitignored in `.gitignore` to keep repository lightweight).

### `ffprobe` Verification Output:
```text
width=1280
height=720
r_frame_rate=25/1
duration=96.480000
nb_frames=2412
```

---

## 5. Domain Assumptions & Caveats

1. **Camera Geometry & Stop Line**:
   - The camera overlooks an organic urban junction in Delhi with informal stop-and-yield lines rather than strict automated enforcement stop bars. In `config/camera_calibration.yaml`, entry and choke zones are calibrated to map to this conflict area.
2. **3-Wheeler Taxonomy (Auto-Rickshaw vs. E-Rickshaw)**:
   - In alignment with the IDD-FG fine-tuning taxonomy documented in `docs/model_card.md`, all 3-wheelers (CNG autos, petrol autos, and electric e-rickshaws) are classified under `auto_rickshaw`.
   - Emission factor modeling applies standard CPCB/EPA-style 3-wheeler factors (`idle_g_per_min: 12`, `cruise_g_per_km: 95`, `accel_multiplier: 1.4`). This serves as a conservative upper bound for carbon accounting until electric 3-wheeler sub-classification is introduced in Phase 2.
3. **Non-Motorized Road Users**:
   - Cycle rickshaws, pushcarts, and pedestrians frequently traverse the choke point. These road users are correctly filtered out from the tailpipe carbon ledger, though their kinematic obstruction realistically models why motorized vehicles decelerate and idle.
4. **Heavy Commercial Representation**:
   - Heavy transit is represented by local mini-trucks, tempos, and delivery vans (detected as `truck`), which represent the predominant commercial freight profile on central urban arterial roads.
