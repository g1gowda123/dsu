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
    min_idle_s: float = 3.0,
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
    events = _extract_stop_and_accel_events(df_emitted, min_age=min_age, dt_s=dt_s, min_idle_s=3.0)

    # Compute signal savings per class
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
        cruise_rate = (float(cfg.get("cruise_g_per_km", 0.0)) * mean_cruise_speeds[c]) / 3600.0
        accel_mult = float(cfg.get("accel_multiplier", 1.0))

        # Saved = cut_fraction * (idle_rate * idle_s + (accel_multiplier - 1) * cruise_rate * accel_s)
        saved = cut_fraction * (
            idle_rate * idle_s
            + (accel_mult - 1.0) * cruise_rate * accel_s
        )

        signal_savings_per_class[c] += float(saved)

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
