"""Kinematic state machine and speed proxy calculations.

Pure-math functions free of ultralytics imports so tests run without weights.
"""

from collections import deque
from pathlib import Path
from typing import Any, Deque, Dict, Optional, Sequence, Tuple, Union
import yaml

DEFAULT_MEAN_LENGTH_M: Dict[str, float] = {
    "car": 4.5,
    "motorcycle": 2.0,
    "bus": 12.0,
    "truck": 10.0,
    "auto_rickshaw": 3.0,
}


def load_mean_lengths(config_path: Optional[Union[str, Path]] = None) -> Dict[str, float]:
    """Load vehicle mean length (m) per class from emission_factors.yaml.

    Per spec: auto_rickshaw = 3.0.
    """
    lengths = dict(DEFAULT_MEAN_LENGTH_M)
    if config_path is None:
        cand = Path(__file__).resolve().parent.parent / "config" / "emission_factors.yaml"
        if cand.exists():
            config_path = cand
    if config_path and Path(config_path).exists():
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
            if data and "classes" in data:
                for cls_name, cls_data in data["classes"].items():
                    if isinstance(cls_data, dict) and "mean_length_m" in cls_data:
                        lengths[cls_name] = float(cls_data["mean_length_m"])
        except Exception:
            pass
    # Ground-truth spec fallback: auto_rickshaw = 3.0
    lengths.setdefault("auto_rickshaw", 3.0)
    return lengths


def smooth_speed(prev_ema: float, raw_v_kmh: float, alpha: float) -> float:
    """Exponential Moving Average (EMA) smoothing of speed.

    Formula: EMA_t = alpha * raw_v_kmh + (1 - alpha) * EMA_{t-1}
    """
    return float(alpha * raw_v_kmh + (1.0 - alpha) * prev_ema)


def classify_state(
    window_speeds: Sequence[float],
    v_now: float,
    hist_max_kmh: float,
    th: Optional[Dict[str, Any]] = None,
    age: Optional[int] = None,
    window_size: Optional[int] = None,
) -> str:
    """Classify kinematic state of a track based on window speeds and peak speed.

    Rules (EXACT):
      - len(window) < window_size or age < 3 → "UNINIT"
      - v_now < idle_v_kmh and max(window) < idle_v_kmh and hist_max_kmh > 5 → "IDLE"
      - delta = v_now - window[0]; delta > 5 → "ACCEL"; delta < -5 → "DECEL"
      - else → "CRUISE"
    """
    if th is None:
        th = {}

    if window_size is None:
        window_size = th.get("window_size")
        if window_size is None and hasattr(window_speeds, "maxlen") and window_speeds.maxlen is not None:
            window_size = window_speeds.maxlen
        if window_size is None and "idle_min_seconds" in th and "dt_s" in th and float(th["dt_s"]) > 0:
            window_size = round(float(th["idle_min_seconds"]) / float(th["dt_s"]))
        if window_size is None:
            window_size = len(window_speeds)

    if age is None:
        age = th.get("age", len(window_speeds))

    if len(window_speeds) < window_size or age < 3:
        return "UNINIT"

    idle_v_kmh = float(th.get("idle_v_kmh", 2.0))
    if v_now < idle_v_kmh and max(window_speeds) < idle_v_kmh and hist_max_kmh > 5.0:
        return "IDLE"

    delta = v_now - window_speeds[0]
    if delta > 5.0:
        return "ACCEL"
    elif delta < -5.0:
        return "DECEL"
    else:
        return "CRUISE"


class TrackState(dict):
    """Dictionary subclass supporting attribute-style property access."""

    def __getattr__(self, name: str) -> Any:
        try:
            return self[name]
        except KeyError:
            raise AttributeError(f"'TrackState' object has no attribute '{name}'")

    def __setattr__(self, name: str, value: Any) -> None:
        self[name] = value


def update_track(
    state: Optional[Union[Dict[str, Any], TrackState]],
    cx_norm: float,
    cy_norm: float,
    bbox_w_px: float,
    dt_s: float,
    cfg: Optional[Dict[str, Any]] = None,
) -> TrackState:
    """Update kinematic tracking state.

    Maintains:
      - last centroid
      - EMA speed
      - deque of last window_size speeds (window_size = round(3s / dt_s))
      - hist_max_kmh
      - track_age_frames

    Speed proxy (exact):
      raw_v = |Δcentroid_px| / bbox_w_px * mean_length_m[cls] * 3.6
      centroid_px = cx_norm * img_w
      If bbox_w_px < 5: keep previous EMA.
      First observation: EMA=0, state UNINIT.
      mean_length_m comes from config/emission_factors.yaml per class (auto_rickshaw = 3.0).
    """
    if cfg is None:
        cfg = {}

    if dt_s > 0:
        window_size = max(1, round(3.0 / dt_s))
    else:
        window_size = int(cfg.get("window_size", 15))

    img_w = float(cfg.get("img_w", cfg.get("imgsz", 640)))
    alpha = float(cfg.get("ema_alpha", 0.3))
    cls_name = str(cfg.get("cls", "car"))

    mean_length_map = cfg.get("mean_length_m")
    if isinstance(mean_length_map, (int, float)):
        mean_length_m = float(mean_length_map)
    elif isinstance(mean_length_map, dict):
        mean_length_m = float(mean_length_map.get(cls_name, DEFAULT_MEAN_LENGTH_M.get(cls_name, 4.5)))
    else:
        mean_length_m = float(DEFAULT_MEAN_LENGTH_M.get(cls_name, 4.5))

    th = cfg.get("state_thresholds", {})
    if not isinstance(th, dict):
        th = {}

    # First observation
    if state is None or len(state) == 0:
        window: Deque[float] = deque([0.0], maxlen=window_size)
        return TrackState({
            "centroid": (float(cx_norm), float(cy_norm)),
            "ema_speed": 0.0,
            "speed_kmh": 0.0,
            "window_speeds": window,
            "hist_max_kmh": 0.0,
            "track_age_frames": 1,
            "state": "UNINIT",
            "cls": cls_name,
        })

    prev_cx, prev_cy = state["centroid"]
    prev_ema = float(state.get("ema_speed", state.get("speed_kmh", 0.0)))
    hist_max_kmh = float(state.get("hist_max_kmh", 0.0))
    track_age_frames = int(state.get("track_age_frames", 1)) + 1
    window = state.get("window_speeds")
    if window is None or not isinstance(window, deque) or window.maxlen != window_size:
        items = list(window) if window else [prev_ema]
        window = deque(items, maxlen=window_size)

    # Speed proxy calculation
    if bbox_w_px < 5.0:
        # If bbox_w_px < 5: keep previous EMA
        v_now = prev_ema
    else:
        use_2d = cfg.get("use_2d_motion", True)
        if use_2d:
            img_h = float(cfg.get("img_h", img_w))
            dx = (float(cx_norm) - float(prev_cx)) * img_w
            dy = (float(cy_norm) - float(prev_cy)) * img_h
            delta_centroid_px = (dx * dx + dy * dy) ** 0.5
        else:
            centroid_px = float(cx_norm) * img_w
            prev_centroid_px = float(prev_cx) * img_w
            delta_centroid_px = abs(centroid_px - prev_centroid_px)

        use_dt = cfg.get("use_dt_in_speed", True)
        if use_dt and dt_s > 0:
            raw_v = (delta_centroid_px / (float(bbox_w_px) * dt_s)) * mean_length_m * 3.6
        else:
            raw_v = (delta_centroid_px / float(bbox_w_px)) * mean_length_m * 3.6

        v_now = smooth_speed(prev_ema, raw_v, alpha)

    hist_max_kmh = max(hist_max_kmh, v_now)
    window.append(v_now)

    current_state = classify_state(
        window_speeds=window,
        v_now=v_now,
        hist_max_kmh=hist_max_kmh,
        th=th,
        age=track_age_frames,
        window_size=window_size,
    )

    # Mutate in-place and return TrackState
    state["centroid"] = (float(cx_norm), float(cy_norm))
    state["ema_speed"] = float(v_now)
    state["speed_kmh"] = float(v_now)
    state["window_speeds"] = window
    state["hist_max_kmh"] = float(hist_max_kmh)
    state["track_age_frames"] = track_age_frames
    state["state"] = current_state
    state["cls"] = cls_name

    if isinstance(state, TrackState):
        return state
    return TrackState(state)
