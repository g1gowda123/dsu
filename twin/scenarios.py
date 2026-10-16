"""What-if Scenario Counterfactual Simulation Engine.

Simulates counterfactual traffic interventions (fleet electrification, green extension,
and heavy-vehicle restriction) against baseline telemetry ledgers.
High performance, fully vectorized, target <1s on 10-minute telemetry.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Union
import numpy as np
import pandas as pd

from twin.emission_engine import compute_track_emissions, get_class_factors


def _extract_stop_and_accel_events(
    df: pd.DataFrame,
    min_age: int = 15,
    dt_s: float = 0.08,
    min_idle_s: float = 1.0,
) -> List[Dict[str, Any]]:
    """Extract stop events with corresponding subsequent acceleration durations.

    Each event dict contains:
        track_id: int
        cls: str
        idle_s: float
        accel_s: float
    """
    events = []
    min_idle_frames = int(round(min_idle_s / dt_s))

    for track_id, group in df.groupby("track_id", sort=False):
        group_sorted = group.sort_values("video_time_s")
        # Check track age gate: only count events if track reaches min_age
        if group_sorted["track_age_frames"].max() < min_age:
            continue

        states = group_sorted["state"].values
        cls_val = str(group_sorted["cls"].iloc[0])
        n = len(states)
        is_idle = (states == "IDLE")

        if not np.any(is_idle):
            continue

        diff = np.diff(np.concatenate(([False], is_idle, [False])).astype(int))
        run_starts = np.where(diff == 1)[0]
        run_ends = np.where(diff == -1)[0]

        for start_idx, end_idx in zip(run_starts, run_ends):
            idle_len = end_idx - start_idx
            if idle_len >= min_idle_frames:
                idle_s = float(idle_len * dt_s)

                # Look for subsequent ACCEL frames immediately following IDLE
                accel_len = 0
                idx = end_idx
                while idx < n and states[idx] == "ACCEL":
                    accel_len += 1
                    idx += 1

                accel_s = float(accel_len * dt_s)

                events.append({
                    "track_id": int(track_id),
                    "cls": cls_val,
                    "idle_s": idle_s,
                    "accel_s": accel_s,
                })

    return events

def compute_event_savings(
    events: List[Dict[str, Any]],
    factors: Dict[str, Any],
    mean_cruise_speeds: Dict[str, float],
    green_extension_s: int = 0,
    heavy_restriction: bool = False,
    classes: Optional[List[str]] = None,
) -> Dict[str, float]:
    """Compute CO2 savings per class from signal policy intervention."""
    if classes is None:
        classes = ["motorcycle", "car", "auto_rickshaw", "bus", "truck"]
    classes = sorted(list(set(classes + list(mean_cruise_speeds.keys()))))
    signal_savings_per_class: Dict[str, float] = {c: 0.0 for c in classes}

    for ev in events:
        c = ev["cls"]
        idle_s = ev["idle_s"]
        accel_s = ev["accel_s"]

        # Determine effective green extension X
        if c in ("bus", "truck") and heavy_restriction:
            eff_x = max(green_extension_s, 10)
        else:
            eff_x = green_extension_s

        if eff_x <= 0 or idle_s <= 0:
            continue

        cut_fraction = min(1.0, float(eff_x) / idle_s)

        cfg = get_class_factors(factors, c)
        idle_rate = float(cfg.get("idle_g_per_min", 0.0)) / 60.0
        cruise_speed = mean_cruise_speeds.get(c, 36.0)
        cruise_rate = (float(cfg.get("cruise_g_per_km", 0.0)) * cruise_speed) / 3600.0
        accel_mult = float(cfg.get("accel_multiplier", 1.0))

        saved = cut_fraction * (
            idle_rate * idle_s
            + (accel_mult - 1.0) * cruise_rate * accel_s
        )

        signal_savings_per_class[c] += float(saved)

    return signal_savings_per_class


def apply_scenario(
    df: pd.DataFrame,
    factors: Dict[str, Any],
    ev_share: Optional[Dict[str, float]] = None,
    green_extension_s: int = 0,
    heavy_restriction: bool = False,
    min_age: int = 15,
    dt_s: float = 0.08,
) -> Dict[str, Any]:
    """Simulate what-if counterfactual scenario against baseline telemetry.

    Semantics (deterministic and defensible):
        a) EV share s per class: That class's tailpipe CO2 is reduced by (1 - s).
           Electrification directly substitutes internal combustion tailpipe emissions.
        b) Green extension X (0-15s): For each stop event, cut_fraction = min(1, X / duration_s).
           Saved = cut_fraction * (
               idle_rate(cls) * idle_s
               + (accel_multiplier - 1) * cruise_rate(cls, mean_cruise_speed_of_class) * accel_s
           )
           Vehicles traverse the intersection regardless; this saves the idling emissions
           and the re-acceleration penalty over cruising.
        c) Heavy vehicle restriction: Same formula applied to bus/truck stop events with X=10s fixed.
           Prioritizes high-emission heavy vehicles through the corridor.

    This function is pure and vectorized; it does NOT mutate the input dataframe.

    Returns:
        {
            "baseline_co2_g": float,
            "scenario_co2_g": float,
            "avoided_g": float,
            "per_class_breakdown": {
                cls: {
                    "baseline_co2_g": float,
                    "scenario_co2_g": float,
                    "avoided_g": float,
                    "ev_share": float,
                }
            },
            "assumptions": List[str]
        }
    """
    if ev_share is None:
        ev_share = {}

    green_extension_s = max(0, min(15, int(green_extension_s)))

    # Compute baseline emissions if not already present
    if "co2_rate_gps" not in df.columns:
        df_emitted = compute_track_emissions(df, factors, min_age=min_age)
    else:
        df_emitted = df.copy()

    # Determine frame dt
    if "_dt_s" not in df_emitted.columns:
        dt_col = df_emitted.groupby("track_id", sort=False)["video_time_s"].diff().bfill().fillna(dt_s)
        dt_vals = dt_col.clip(lower=0.001, upper=5.0).values
    else:
        dt_vals = df_emitted["_dt_s"].values

    # Gated mask: track_age_frames >= min_age and state in valid states
    age_vals = df_emitted["track_age_frames"].values
    state_vals = df_emitted["state"].values
    cls_vals = df_emitted["cls"].values
    rate_vals = df_emitted["co2_rate_gps"].values

    gated_mask = (age_vals >= min_age) & np.isin(state_vals, ["IDLE", "ACCEL", "CRUISE", "DECEL"])

    # Calculate baseline gated emissions per frame
    frame_co2 = np.where(gated_mask, rate_vals * dt_vals, 0.0)

    # All known classes (including auto_rickshaw)
    all_classes = ["motorcycle", "car", "auto_rickshaw", "bus", "truck"]
    present_classes = list(np.unique(cls_vals))
    classes = sorted(list(set(all_classes + present_classes)))

    # Compute mean cruise speed per class
    mean_cruise_speeds: Dict[str, float] = {}
    for c in classes:
        c_cruise_mask = (cls_vals == c) & (state_vals == "CRUISE")
        if np.any(c_cruise_mask):
            mean_cruise_speeds[c] = float(np.mean(df_emitted.loc[c_cruise_mask, "speed_kmh"]))
        else:
            mean_cruise_speeds[c] = 36.0  # Plausible urban default

    # Baseline CO2 per class
    baseline_per_class: Dict[str, float] = {}
    for c in classes:
        c_mask = (cls_vals == c)
        baseline_per_class[c] = float(np.sum(frame_co2[c_mask]))

    # Extract stop and accel events
    events = _extract_stop_and_accel_events(df_emitted, min_age=min_age, dt_s=dt_s, min_idle_s=1.0)

    # Compute signal savings per class via shared helper
    signal_savings_per_class = compute_event_savings(
        events=events,
        factors=factors,
        mean_cruise_speeds=mean_cruise_speeds,
        green_extension_s=green_extension_s,
        heavy_restriction=heavy_restriction,
        classes=classes,
    )

    # Combine signal savings with EV penetration
    per_class_breakdown: Dict[str, Dict[str, float]] = {}
    scenario_per_class: Dict[str, float] = {}

    for c in classes:
        base_g = baseline_per_class[c]
        sig_save = min(base_g, signal_savings_per_class[c])
        co2_after_signal = max(0.0, base_g - sig_save)

        s = float(np.clip(ev_share.get(c, 0.0), 0.0, 1.0))
        scen_g = float(co2_after_signal * (1.0 - s))
        avoided_c = float(base_g - scen_g)

        scenario_per_class[c] = scen_g
        per_class_breakdown[c] = {
            "baseline_co2_g": float(round(base_g, 4)),
            "scenario_co2_g": float(round(scen_g, 4)),
            "avoided_g": float(round(avoided_c, 4)),
            "ev_share": float(round(s, 4)),
        }

    total_baseline_g = float(sum(baseline_per_class.values()))
    total_scenario_g = float(sum(scenario_per_class.values()))
    total_avoided_g = float(max(0.0, total_baseline_g - total_scenario_g))

    assumptions = [
        "EV fleet share directly eliminates tailpipe CO2 for the electrified vehicle proportion.",
        f"Green extension of {green_extension_s}s reduces stop duration and re-acceleration penalty by min(1, X/idle_s).",
        f"Heavy vehicle restriction is {'ACTIVE (10s priority wave for bus/truck)' if heavy_restriction else 'INACTIVE'}.",
        "Through-trip cruising energy is conserved; savings arise exclusively from avoiding idle and acceleration penalties.",
    ]

    return {
        "baseline_co2_g": float(round(total_baseline_g, 4)),
        "scenario_co2_g": float(round(total_scenario_g, 4)),
        "avoided_g": float(round(total_avoided_g, 4)),
        "per_class_breakdown": per_class_breakdown,
        "assumptions": assumptions,
    }


def compute_action_savings(
    actions: List[Any],
    factors: Dict[str, Any],
    df: Optional[pd.DataFrame] = None,
    payload: Optional[Union[Dict[str, Any], Any]] = None,
    min_age: int = 15,
    dt_s: float = 0.08,
) -> float:
    """Compute estimated CO2 savings in grams for a set of dispatcher actions.

    Reuses the exact same mathematical model as What-If apply_scenario.
    When df is provided:
        Matches apply_scenario(df, factors, ...)['avoided_g'] identically.
    When only payload is provided:
        Computes analytical savings based on CPCB emission factors, idle duration,
        and stop counts.
    Returns 0.0 if all actions are no_action.
    """
    if not actions:
        return 0.0

    # Check if all actions are NO_ACTION
    has_active_action = False
    green_extension_s = 0
    heavy_restriction = False

    for a in actions:
        a_type = a.type.value if hasattr(a.type, "value") else str(getattr(a, "type", a))
        if a_type != "no_action":
            has_active_action = True
        sec = getattr(a, "seconds", None) or 0
        target_cls = getattr(a, "target_class", None)

        if a_type == "extend_green":
            green_extension_s = max(green_extension_s, int(sec))
        elif a_type in ("heavy_vehicle_restriction", "green_wave_priority"):
            if target_cls in ("bus", "truck", None):
                heavy_restriction = True
                green_extension_s = max(green_extension_s, int(sec) if sec > 0 else 10)
            else:
                green_extension_s = max(green_extension_s, int(sec))

    if not has_active_action or (green_extension_s <= 0 and not heavy_restriction):
        return 0.0

    if df is not None and not df.empty:
        res = apply_scenario(
            df=df,
            factors=factors,
            ev_share={},
            green_extension_s=green_extension_s,
            heavy_restriction=heavy_restriction,
            min_age=min_age,
            dt_s=dt_s,
        )
        return float(round(res["avoided_g"], 4))

    # Analytical computation from payload when df is not available
    if payload is None:
        return float(round(15.0 * green_extension_s / 10.0, 4))

    # Extract metrics from payload dict or Pydantic model
    n_stops = int(payload.get("n_stop_events", 0) if isinstance(payload, dict) else getattr(payload, "n_stop_events", 0))
    co2_total = float(payload.get("co2_g_total", 0.0) if isinstance(payload, dict) else getattr(payload, "co2_g_total", 0.0))
    idle_ratio = float(payload.get("idle_ratio", 0.0) if isinstance(payload, dict) else getattr(payload, "idle_ratio", 0.0))
    heavy_density = float(payload.get("heavy_vehicle_density", 0.0) if isinstance(payload, dict) else getattr(payload, "heavy_vehicle_density", 0.0))
    window_s = float(payload.get("window_s", 60.0) if isinstance(payload, dict) else getattr(payload, "window_s", 60.0))

    top_choke = payload.get("top_choke_zone") if isinstance(payload, dict) else getattr(payload, "top_choke_zone", None)
    if isinstance(top_choke, dict):
        idle_min = float(top_choke.get("idle_vehicle_minutes", 0.0))
    elif top_choke is not None and hasattr(top_choke, "idle_vehicle_minutes"):
        idle_min = float(top_choke.idle_vehicle_minutes)
    else:
        idle_min = (window_s / 60.0) * idle_ratio * max(1, int(payload.get("n_counted_vehicles", 1) if isinstance(payload, dict) else getattr(payload, "n_counted_vehicles", 1)))

    if n_stops == 0 and idle_min > 0:
        n_stops = max(1, int(round(idle_min * 1.5)))

    if n_stops == 0:
        return 0.0

    avg_idle_s = max(3.0, (idle_min * 60.0) / max(1, n_stops))

    # CPCB Emission parameters
    # Bus/truck (heavy): idle ~50 g/min = 0.833 g/s, cruise ~950 g/km @ 36 km/h = 9.5 g/s, accel mult ~1.9 -> accel penalty ~ 0.9 * 9.5 * 3s = 25.65 g
    idle_rate_heavy = 50.0 / 60.0
    accel_penalty_heavy = 25.65

    # Light (car, bike, auto): idle ~14 g/min = 0.233 g/s, cruise ~108 g/km @ 36 km/h = 1.08 g/s, accel mult ~1.47 -> accel penalty ~ 0.47 * 1.08 * 2s = 1.015 g
    idle_rate_light = 14.0 / 60.0
    accel_penalty_light = 1.015

    if heavy_restriction:
        eff_x = max(green_extension_s, 10)
        cut_fraction = min(1.0, float(eff_x) / avg_idle_s)
        n_heavy_stops = max(1, int(round(n_stops * max(0.25, heavy_density))))
        saved = n_heavy_stops * (cut_fraction * (idle_rate_heavy * avg_idle_s + accel_penalty_heavy))
    else:
        eff_x = green_extension_s
        cut_fraction = min(1.0, float(eff_x) / avg_idle_s)
        idle_rate_mix = heavy_density * idle_rate_heavy + (1.0 - heavy_density) * idle_rate_light
        accel_penalty_mix = heavy_density * accel_penalty_heavy + (1.0 - heavy_density) * accel_penalty_light
        saved = n_stops * (cut_fraction * (idle_rate_mix * avg_idle_s + accel_penalty_mix))

    saved = max(0.0, float(saved))
    if co2_total > 0:
        saved = min(saved, co2_total)
    return float(round(saved, 4))

