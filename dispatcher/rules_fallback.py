"""Deterministic rules-based dispatcher fallback engine.

Provides zero-dependency, guaranteed-valid municipal signal directives when
the LLM service is offline, slow, or fails validation.
Uses identical carbon accounting as the What-If counterfactual twin.
"""

from __future__ import annotations

from pathlib import Path
import re
from typing import Any, Dict, List, Literal, Optional, Union
import pandas as pd
import yaml

from dispatcher.schema import Action, ActionType, CorridorPayload, Directive, Lane, TargetClass
from twin.scenarios import compute_action_savings

DEFAULT_FACTORS_PATH = Path(__file__).resolve().parent.parent / "config" / "emission_factors.yaml"


def _load_factors(factors_path: Optional[Union[str, Path]] = None) -> Dict[str, Any]:
    path = Path(factors_path) if factors_path else DEFAULT_FACTORS_PATH
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    return {}


load_emission_factors = _load_factors


def _determine_lane_from_zone(zone_id: Optional[str]) -> Literal["N", "S", "E", "W"]:
    """Map 4x4 spatial zone id (e.g. z_r1_c2 or 0_1) to cardinal approach axis."""
    if not zone_id:
        return "N"
    # Support both "z_r1_c2" and "0_1" formats
    m = re.match(r"(?:z_r)?(\d)(?:_c|_)?(\d)", str(zone_id))
    if not m:
        return "N"
    r, c = int(m.group(1)), int(m.group(2))
    # r is cy_norm (0=North, 3=South), c is cx_norm (0=West, 3=East)
    if r == 0:
        return "N"
    if r == 3:
        return "S"
    if c == 0:
        return "W"
    if c == 3:
        return "E"
    if r < c:
        return "N" if r <= 1 else "E"
    return "S" if r >= 2 else "W"


def compute_deterministic_co2_saved(
    actions: List[Action],
    payload: Union[CorridorPayload, Dict[str, Any]],
    factors: Optional[Dict[str, Any]] = None,
) -> float:
    """Deterministic calculation of carbon savings from action parameters and payload metrics."""
    factors_dict = factors if factors is not None else _load_factors()
    return compute_action_savings(
        actions=actions,
        factors=factors_dict,
        payload=payload,
    )


def rules_fallback(
    payload: Union[CorridorPayload, Dict[str, Any]],
    df: Optional[pd.DataFrame] = None,
    factors: Optional[Dict[str, Any]] = None,
    intersection_id: Optional[str] = None,
) -> Directive:
    """Evaluate corridor telemetry payload against deterministic thresholds.

    Rules:
      1. idle_vehicle_minutes > 5.0 OR idle_ratio > 0.40:
         -> extend_green on the congested axis, 8-12s.
      2. heavy_vehicle_density > 0.15 AND (n_stops >= 3 or heavy_vehicle_density >= 0.20):
         -> heavy_vehicle_restriction / green_wave_priority, 10s, bus/truck.
      3. Otherwise:
         -> no_action (savings = 0.0g).

    Always sets mode="rules_fallback", confidence=0.85.
    Calculates estimated_co2_saved_g deterministically using shared twin math.
    """
    if isinstance(payload, dict):
        p_obj = CorridorPayload(**payload)
    else:
        p_obj = payload

    factors_dict = factors if factors is not None else _load_factors()
    inter_id = intersection_id or p_obj.intersection_id

    idle_ratio = float(p_obj.idle_ratio)
    heavy_density = float(p_obj.heavy_vehicle_density)
    n_stops = int(p_obj.n_stop_events)

    idle_vehicle_min = 0.0
    zone_id = None
    if p_obj.top_choke_zone is not None:
        idle_vehicle_min = float(p_obj.top_choke_zone.idle_vehicle_minutes)
        zone_id = str(p_obj.top_choke_zone.id)

    lane = _determine_lane_from_zone(zone_id)
    actions: List[Action] = []
    rationale = ""

    # Rule 1: High congestion / idle backlog
    if idle_vehicle_min > 5.0 or idle_ratio > 0.40:
        if idle_vehicle_min >= 8.0 or idle_ratio >= 0.55:
            seconds = 12
        elif idle_vehicle_min >= 6.5 or idle_ratio >= 0.45:
            seconds = 10
        else:
            seconds = 8

        actions = [
            Action(
                type=ActionType.EXTEND_GREEN,
                lane=lane,
                seconds=seconds,
                target_class=None,
            )
        ]
        rationale = (
            f"Congestion trigger: idle ratio {idle_ratio:.1%} (choke dwell {idle_vehicle_min:.1f}m). "
            f"Extending green by {seconds}s on {lane} approach to flush queue and minimize idling CO2."
        )

    # Rule 2: Heavy vehicle transit delay
    elif heavy_density > 0.15 and (n_stops >= 3 or (heavy_density >= 0.20 and (n_stops >= 1 or idle_vehicle_min > 0.01))):
        actions = [
            Action(
                type=ActionType.HEAVY_VEHICLE_RESTRICTION,
                lane=lane,
                seconds=10,
                target_class="truck",
            ),
            Action(
                type=ActionType.GREEN_WAVE_PRIORITY,
                lane=lane,
                seconds=10,
                target_class="bus",
            ),
        ]
        rationale = (
            f"Heavy vehicle trigger: {heavy_density:.1%} heavy density with {n_stops} stop events. "
            f"Activating 10s green wave priority & heavy restriction on {lane} to avoid high diesel stop penalties."
        )

    # Rule 3: Nominal corridor conditions
    else:
        actions = [
            Action(
                type=ActionType.NO_ACTION,
                lane=None,
                seconds=None,
                target_class=None,
            )
        ]
        rationale = (
            f"Corridor nominal: idle ratio {idle_ratio:.1%}, heavy density {heavy_density:.1%}. "
            "No signal timing modification required."
        )

    # Enforce maximum rationale length
    if len(rationale) > 300:
        rationale = rationale[:297] + "..."

    # Re-use exact same math as twin/scenarios.py
    co2_saved = compute_action_savings(
        actions=actions,
        factors=factors_dict,
        df=df,
        payload=p_obj,
    )

    return Directive(
        intersection_id=inter_id,
        actions=actions,
        estimated_co2_saved_g=co2_saved,
        confidence=0.85,
        rationale=rationale,
        mode="rules_fallback",
    )


def generate_fallback_directive(
    payload: Union[CorridorPayload, Dict[str, Any]],
    intersection_id: Optional[str] = None,
) -> Directive:
    """Alias matching alternative caller signature."""
    return rules_fallback(payload=payload, intersection_id=intersection_id)
