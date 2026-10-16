"""Deterministic rules-based municipal traffic dispatcher and emissions savings engine.

Provides guaranteed offline / fallback decision making and strictly deterministic
Python calculation of avoided CO2 emissions. Never delegates math to an LLM.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Union
import yaml

from dispatcher.schema import (
    Action,
    ActionType,
    CorridorPayload,
    Directive,
    Lane,
    TargetClass,
    TopChokeZone,
)

DEFAULT_EMISSION_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "emission_factors.yaml"


def load_emission_factors(config_path: Optional[Union[str, Path]] = None) -> Dict[str, Any]:
    """Load class emission factors from config/emission_factors.yaml."""
    target_path = Path(config_path) if config_path else DEFAULT_EMISSION_CONFIG_PATH
    if target_path.exists():
        with open(target_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
            if isinstance(data, dict):
                return data
    # Fallback to CPCB BS-VI standard defaults
    return {
        "classes": {
            "car": {"idle_g_per_min": 22},
            "motorcycle": {"idle_g_per_min": 8},
            "auto_rickshaw": {"idle_g_per_min": 12},
            "bus": {"idle_g_per_min": 45},
            "truck": {"idle_g_per_min": 55},
        }
    }


def compute_deterministic_co2_saved(
    actions: List[Action],
    payload: Union[CorridorPayload, Dict[str, Any]],
    emission_cfg: Optional[Dict[str, Any]] = None,
) -> float:
    """Compute avoided CO2 grams deterministically in Python based on CPCB factors.

    Formula:
      - extend_green: Clears queue vehicles, saving red-phase dwell time.
      - green_wave_priority: Avoids deceleration and idle stop cycles for platoons.
      - heavy_vehicle_restriction: Diverts/holds heavy diesel polluters (bus/truck)
        away from congested bottleneck, saving heavy idle rates.
      - no_action: 0.0g.
    """
    if not actions:
        return 0.0

    if isinstance(payload, CorridorPayload):
        p_dict = payload.model_dump()
    else:
        p_dict = dict(payload)

    if emission_cfg is None:
        emission_cfg = load_emission_factors()

    classes_cfg = emission_cfg.get("classes", {})
    idle_rates = {
        cls: classes_cfg.get(cls, {}).get("idle_g_per_min", 20.0) / 60.0
        for cls in ["car", "motorcycle", "auto_rickshaw", "bus", "truck"]
    }

    # Blended representative fleet idle rate (g/s)
    # Typical Indian urban mix: 50% moto, 25% car, 15% auto, 5% bus, 5% truck
    blended_idle_gps = (
        0.50 * idle_rates.get("motorcycle", 0.133)
        + 0.25 * idle_rates.get("car", 0.367)
        + 0.15 * idle_rates.get("auto_rickshaw", 0.200)
        + 0.05 * idle_rates.get("bus", 0.750)
        + 0.05 * idle_rates.get("truck", 0.917)
    )
    heavy_idle_gps = 0.5 * (idle_rates.get("bus", 0.750) + idle_rates.get("truck", 0.917))

    total_saved_g = 0.0
    n_counted = max(1, int(p_dict.get("n_counted_vehicles", 10)))
    idle_ratio = float(p_dict.get("idle_ratio", 0.0))
    heavy_density = float(p_dict.get("heavy_vehicle_density", 0.0))

    # Estimated idling queue size
    estimated_idlers = max(1.0, n_counted * max(0.20, idle_ratio))

    for act in actions:
        if act.type == ActionType.NO_ACTION:
            continue

        seconds = act.seconds if act.seconds is not None else 10

        if act.type == ActionType.EXTEND_GREEN:
            # Extending green lets a queue slice discharge without full red dwell cycle (avg 25s red dwell saved)
            discharge_rate_vps = 0.8  # ~0.8 vehicles per second per lane
            cleared_vehicles = min(estimated_idlers, max(1.0, seconds * discharge_rate_vps))
            avoided_dwell_s = 25.0
            saved = cleared_vehicles * avoided_dwell_s * blended_idle_gps
            total_saved_g += saved

        elif act.type == ActionType.GREEN_WAVE_PRIORITY:
            # Coordinated green wave eliminates deceleration-stop-idle-acceleration penalty
            target_cls = act.target_class.value if act.target_class else None
            rate = idle_rates.get(target_cls, heavy_idle_gps) if target_cls in ["bus", "truck"] else blended_idle_gps
            platoon_size = max(2.0, n_counted * 0.15)
            avoided_stop_penalty_s = 20.0
            saved = platoon_size * avoided_stop_penalty_s * rate
            total_saved_g += saved

        elif act.type == ActionType.HEAVY_VEHICLE_RESTRICTION:
            # Prevents heavy vehicle idling in gridlock choke zone
            heavy_count = max(1.0, n_counted * max(0.10, heavy_density))
            saved = heavy_count * (seconds * 2.0) * heavy_idle_gps
            total_saved_g += saved

    return float(round(total_saved_g, 2))


def _deduce_lane_from_choke(choke_id: Optional[str]) -> Lane:
    """Infer dominant directional approach from 4x4 spatial choke cell ID."""
    if not choke_id:
        return Lane.N
    # 4x4 grid: row 0: N, row 3: S, col 0: W, col 3: E
    parts = choke_id.split("_")
    if len(parts) >= 2:
        try:
            r, c = int(parts[0]), int(parts[1])
            if r == 0:
                return Lane.N
            if r == 3:
                return Lane.S
            if c == 0:
                return Lane.W
            if c == 3:
                return Lane.E
        except ValueError:
            pass
    return Lane.N


def generate_fallback_directive(
    payload: Union[CorridorPayload, Dict[str, Any]],
    emission_cfg: Optional[Dict[str, Any]] = None,
) -> Directive:
    """Generate a guaranteed schema-valid Directive using deterministic operational rules.

    Operational Rules:
      1. Heavy Idle Choke: If top_choke_zone has > 5.0 idle-vehicle-min OR idle_ratio > 0.40:
         Trigger EXTEND_GREEN (8-12s) on the congested approach.
      2. Heavy Vehicle Congestion: If heavy_vehicle_density > 0.15 and stop events >= 4:
         Trigger HEAVY_VEHICLE_RESTRICTION or GREEN_WAVE_PRIORITY for 10s on bus/truck.
      3. Moderate Congestion: If idle_ratio between 0.25 and 0.40:
         Trigger GREEN_WAVE_PRIORITY on main corridor for 8s.
      4. Nominal flow: Return NO_ACTION.
    """
    if isinstance(payload, CorridorPayload):
        p_dict = payload.model_dump()
    else:
        p_dict = dict(payload)

    intersection_id = str(p_dict.get("intersection_id", "junction_01"))
    timestamp = p_dict.get("timestamp") or datetime.now(timezone.utc).isoformat()
    idle_ratio = float(p_dict.get("idle_ratio", 0.0))
    heavy_density = float(p_dict.get("heavy_vehicle_density", 0.0))
    n_stops = int(p_dict.get("n_stop_events", 0))

    top_choke = p_dict.get("top_choke_zone")
    choke_id = None
    choke_idle_min = 0.0
    if isinstance(top_choke, dict):
        choke_id = top_choke.get("id")
        choke_idle_min = float(top_choke.get("idle_vehicle_minutes", 0.0))
    elif isinstance(top_choke, TopChokeZone):
        choke_id = top_choke.id
        choke_idle_min = top_choke.idle_vehicle_minutes

    actions: List[Action] = []
    confidence = 0.88
    rationale = ""

    # Rule 1: High Idle Choke
    if choke_idle_min >= 4.0 or idle_ratio >= 0.40:
        lane = _deduce_lane_from_choke(choke_id)
        duration = 12 if idle_ratio >= 0.50 else 10
        actions.append(Action(type=ActionType.EXTEND_GREEN, lane=lane, seconds=duration))
        rationale = (
            f"Rule Engine: Idle ratio {idle_ratio:.1%} and choke zone {choke_id or 'core'} "
            f"({choke_idle_min:.1f} idle-veh-min) exceed saturation threshold; granted {duration}s green extension."
        )

    # Rule 2: Heavy Vehicle Saturation
    elif heavy_density >= 0.15 and n_stops >= 3:
        target = TargetClass.TRUCK if heavy_density > 0.25 else TargetClass.BUS
        actions.append(Action(type=ActionType.HEAVY_VEHICLE_RESTRICTION, lane=Lane.N, seconds=10, target_class=target))
        rationale = (
            f"Rule Engine: Heavy vehicle density {heavy_density:.1%} with {n_stops} stop events; "
            f"restricted {target.value} idling via 10s heavy vehicle dispatch regulation."
        )

    # Rule 3: Moderate Congestion -> Green Wave Priority
    elif idle_ratio >= 0.25:
        actions.append(Action(type=ActionType.GREEN_WAVE_PRIORITY, lane=Lane.N, seconds=8))
        rationale = (
            f"Rule Engine: Moderate idle ratio {idle_ratio:.1%}; initiated 8s green wave priority "
            f"to dissipate developing queue."
        )

    # Rule 4: Nominal Conditions
    else:
        actions.append(Action(type=ActionType.NO_ACTION))
        confidence = 0.95
        rationale = (
            f"Rule Engine: Corridor operating nominally (idle {idle_ratio:.1%}, "
            f"heavy density {heavy_density:.1%}); no signal intervention required."
        )

    # Deterministic CO2 calculation
    co2_saved = compute_deterministic_co2_saved(actions, p_dict, emission_cfg)

    return Directive(
        timestamp=str(timestamp),
        intersection_id=intersection_id,
        actions=actions,
        estimated_co2_saved_g=co2_saved,
        confidence=confidence,
        rationale=rationale[:300],
        mode="rules_fallback",
    )
