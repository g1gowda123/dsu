"""Tests for dispatcher Pydantic v2 schemas and validation constraints."""

from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dispatcher.schema import (
    Action,
    ActionType,
    CorridorPayload,
    Directive,
    TopChokeZone,
)
from twin.corridor import to_dispatcher_payload


def test_action_valid():
    """Verify valid action variations."""
    a1 = Action(type=ActionType.EXTEND_GREEN, lane="N", seconds=10)
    assert a1.type == ActionType.EXTEND_GREEN
    assert a1.lane == "N"
    assert a1.seconds == 10
    assert a1.target_class is None

    a2 = Action(
        type=ActionType.HEAVY_VEHICLE_RESTRICTION,
        lane="E",
        seconds=15,
        target_class="bus",
    )
    assert a2.target_class == "bus"

    a3 = Action(type=ActionType.NO_ACTION)
    assert a3.type == ActionType.NO_ACTION
    assert a3.seconds is None


def test_action_rejection():
    """Reject invalid action attributes (bad enum, seconds > 15, negative seconds)."""
    with pytest.raises(ValidationError):
        Action(type="speed_up_traffic")  # type: ignore

    with pytest.raises(ValidationError):
        Action(type=ActionType.EXTEND_GREEN, seconds=20)  # > 15

    with pytest.raises(ValidationError):
        Action(type=ActionType.EXTEND_GREEN, seconds=-1)  # < 0

    with pytest.raises(ValidationError):
        Action(type=ActionType.EXTEND_GREEN, lane="NE")  # type: ignore


def test_directive_roundtrip():
    """Verify full serialization and deserialization roundtrip."""
    action = Action(type=ActionType.EXTEND_GREEN, lane="S", seconds=12)
    directive = Directive(
        intersection_id="junction_01",
        actions=[action],
        estimated_co2_saved_g=45.2,
        confidence=0.85,
        rationale="Heavy queue on south approach flushed via 12s green extension.",
        mode="rules_fallback",
    )

    dumped = directive.model_dump()
    assert dumped["intersection_id"] == "junction_01"
    assert dumped["mode"] == "rules_fallback"
    assert len(dumped["directive_id"]) == 32  # uuid4 hex

    json_str = directive.model_dump_json()
    loaded = Directive.model_validate_json(json_str)
    assert loaded.directive_id == directive.directive_id
    assert loaded.estimated_co2_saved_g == 45.2
    assert loaded.actions[0].type == ActionType.EXTEND_GREEN


def test_directive_rejection_negative_savings():
    """Reject negative CO2 savings."""
    with pytest.raises(ValidationError):
        Directive(
            intersection_id="junction_01",
            actions=[Action(type=ActionType.NO_ACTION)],
            estimated_co2_saved_g=-5.0,
            confidence=0.85,
            rationale="Negative savings should fail",
            mode="rules_fallback",
        )


def test_directive_rejection_confidence_out_of_bounds():
    """Reject confidence not in [0, 1]."""
    with pytest.raises(ValidationError):
        Directive(
            intersection_id="junction_01",
            actions=[Action(type=ActionType.NO_ACTION)],
            estimated_co2_saved_g=0.0,
            confidence=1.5,
            rationale="Confidence too high",
            mode="rules_fallback",
        )

    with pytest.raises(ValidationError):
        Directive(
            intersection_id="junction_01",
            actions=[Action(type=ActionType.NO_ACTION)],
            estimated_co2_saved_g=0.0,
            confidence=-0.1,
            rationale="Confidence negative",
            mode="rules_fallback",
        )


def test_directive_rejection_long_rationale():
    """Reject rationale strictly > 300 characters."""
    valid_rationale = "x" * 300
    d = Directive(
        intersection_id="junction_01",
        actions=[Action(type=ActionType.NO_ACTION)],
        estimated_co2_saved_g=0.0,
        confidence=0.85,
        rationale=valid_rationale,
        mode="rules_fallback",
    )
    assert len(d.rationale) == 300

    invalid_rationale = "x" * 301
    with pytest.raises(ValidationError):
        Directive(
            intersection_id="junction_01",
            actions=[Action(type=ActionType.NO_ACTION)],
            estimated_co2_saved_g=0.0,
            confidence=0.85,
            rationale=invalid_rationale,
            mode="rules_fallback",
        )


def test_directive_rejection_unknown_mode():
    """Reject unknown mode (only 'llm' or 'rules_fallback' permitted)."""
    with pytest.raises(ValidationError):
        Directive(
            intersection_id="junction_01",
            actions=[Action(type=ActionType.NO_ACTION)],
            estimated_co2_saved_g=0.0,
            confidence=0.85,
            rationale="Test mode",
            mode="autonomous_ai",  # type: ignore
        )


def test_corridor_payload_validation_from_twin():
    """Verify CorridorPayload model validates output from to_dispatcher_payload."""
    raw_payload = {
        "intersection_id": "junction_01",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "window_s": 60.0,
        "co2_g_total": 125.4,
        "co2_g_per_min": 125.4,
        "idle_ratio": 0.42,
        "heavy_vehicle_density": 0.18,
        "n_counted_vehicles": 25,
        "n_stop_events": 6,
        "top_choke_zone": {"id": "z_r1_c2", "idle_vehicle_minutes": 6.2},
    }

    payload = CorridorPayload(**raw_payload)
    assert payload.intersection_id == "junction_01"
    assert payload.idle_ratio == 0.42
    assert payload.top_choke_zone is not None
    assert payload.top_choke_zone.id == "z_r1_c2"

    # Also test null top_choke_zone
    raw_payload["top_choke_zone"] = None
    payload_null_zone = CorridorPayload(**raw_payload)
    assert payload_null_zone.top_choke_zone is None


def test_corridor_payload_rejection():
    """Reject invalid corridor payloads (idle_ratio > 1, negative vehicles)."""
    with pytest.raises(ValidationError):
        CorridorPayload(
            intersection_id="junction_01",
            timestamp="2026-10-16T06:00:00Z",
            co2_g_total=100.0,
            co2_g_per_min=100.0,
            idle_ratio=1.5,  # > 1.0
            heavy_vehicle_density=0.1,
            n_counted_vehicles=10,
            n_stop_events=2,
        )

    with pytest.raises(ValidationError):
        CorridorPayload(
            intersection_id="junction_01",
            timestamp="2026-10-16T06:00:00Z",
            co2_g_total=100.0,
            co2_g_per_min=100.0,
            idle_ratio=0.5,
            heavy_vehicle_density=0.1,
            n_counted_vehicles=-3,  # < 0
            n_stop_events=2,
        )
