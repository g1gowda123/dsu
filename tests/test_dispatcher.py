"""Unit and integration tests for the municipal traffic carbon dispatcher.

Covers:
- Milestone M6 verification gate: 20 mock payloads -> 100% schema valid.
- Schema constraints, bounds enforcement, and auto_rickshaw taxonomy.
- Deterministic rules fallback triggers and carbon savings math.
- Mocked LLM execution, 1-retry handling, and graceful offline fallback.
- Persistence to artifacts/directives.jsonl.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest
from pydantic import ValidationError

from dispatcher.schema import (
    Action,
    ActionType,
    CorridorPayload,
    Directive,
    Lane,
    LLMActionChoice,
    TargetClass,
    TopChokeZone,
)
from dispatcher.rules_fallback import (
    compute_deterministic_co2_saved,
    generate_fallback_directive,
    load_emission_factors,
)
from dispatcher.llm_dispatcher import LLMDispatcher, dispatch


def test_schema_valid_action_and_directive():
    """Verify basic instantiation and validation of Action and Directive models."""
    action = Action(
        type=ActionType.EXTEND_GREEN,
        lane=Lane.N,
        seconds=10,
        target_class=None,
    )
    assert action.type == ActionType.EXTEND_GREEN
    assert action.seconds == 10
    assert action.lane == Lane.N

    directive = Directive(
        timestamp="2026-10-16T12:00:00Z",
        intersection_id="junction_01",
        actions=[action],
        estimated_co2_saved_g=145.2,
        confidence=0.92,
        rationale="Extended north green phase to relieve queue buildup.",
        mode="llm",
    )
    assert directive.intersection_id == "junction_01"
    assert directive.mode == "llm"
    assert directive.estimated_co2_saved_g == 145.2


def test_schema_auto_rickshaw_target_class():
    """Verify that auto_rickshaw is a recognized target_class in Action taxonomy."""
    action = Action(
        type=ActionType.GREEN_WAVE_PRIORITY,
        lane=Lane.S,
        seconds=8,
        target_class=TargetClass.AUTO_RICKSHAW,
    )
    assert action.target_class == TargetClass.AUTO_RICKSHAW
    assert action.target_class.value == "auto_rickshaw"


def test_schema_bounds_enforcement():
    """Verify that seconds out-of-bounds (> 15) triggers a ValidationError."""
    with pytest.raises(ValidationError):
        Action(type=ActionType.EXTEND_GREEN, seconds=25)


def test_schema_rationale_truncation():
    """Verify that rationales > 300 characters are safely capped."""
    long_rationale = "A" * 350
    directive = Directive(
        timestamp="2026-10-16T12:00:00Z",
        intersection_id="junction_01",
        actions=[Action(type=ActionType.NO_ACTION)],
        estimated_co2_saved_g=0.0,
        confidence=0.8,
        rationale=long_rationale,
        mode="rules_fallback",
    )
    assert len(directive.rationale) <= 300
    assert directive.rationale.endswith("...")


def test_rules_fallback_high_idle_choke():
    """Verify that severe idle ratio / choke zone triggers extend_green."""
    payload = {
        "intersection_id": "junction_01",
        "timestamp": "2026-10-16T12:00:00Z",
        "idle_ratio": 0.52,
        "heavy_vehicle_density": 0.05,
        "n_counted_vehicles": 24,
        "n_stop_events": 8,
        "top_choke_zone": {"id": "0_1", "idle_vehicle_minutes": 6.5},
    }
    directive = generate_fallback_directive(payload)
    assert directive.mode == "rules_fallback"
    assert len(directive.actions) == 1
    assert directive.actions[0].type == ActionType.EXTEND_GREEN
    assert directive.actions[0].seconds >= 10
    assert directive.estimated_co2_saved_g > 0.0


def test_rules_fallback_heavy_vehicle_saturation():
    """Verify that high heavy vehicle density triggers heavy vehicle intervention."""
    payload = {
        "intersection_id": "junction_02",
        "timestamp": "2026-10-16T12:00:00Z",
        "idle_ratio": 0.20,
        "heavy_vehicle_density": 0.22,
        "n_counted_vehicles": 30,
        "n_stop_events": 6,
        "top_choke_zone": None,
    }
    directive = generate_fallback_directive(payload)
    assert directive.mode == "rules_fallback"
    assert len(directive.actions) == 1
    assert directive.actions[0].type == ActionType.HEAVY_VEHICLE_RESTRICTION
    assert directive.actions[0].target_class in [TargetClass.BUS, TargetClass.TRUCK]
    assert directive.estimated_co2_saved_g > 0.0


def test_rules_fallback_nominal_traffic():
    """Verify that free-flowing nominal traffic produces no_action."""
    payload = {
        "intersection_id": "junction_01",
        "timestamp": "2026-10-16T12:00:00Z",
        "idle_ratio": 0.08,
        "heavy_vehicle_density": 0.04,
        "n_counted_vehicles": 18,
        "n_stop_events": 1,
        "top_choke_zone": None,
    }
    directive = generate_fallback_directive(payload)
    assert directive.mode == "rules_fallback"
    assert directive.actions[0].type == ActionType.NO_ACTION
    assert directive.estimated_co2_saved_g == 0.0


def test_deterministic_co2_math_consistency():
    """Verify that deterministic Python CO2 calculation returns realistic CPCB figures."""
    actions = [Action(type=ActionType.EXTEND_GREEN, lane=Lane.N, seconds=10)]
    payload = {
        "n_counted_vehicles": 20,
        "idle_ratio": 0.45,
        "heavy_vehicle_density": 0.10,
    }
    co2_saved = compute_deterministic_co2_saved(actions, payload)
    # 10s green extension clearing ~8 vehicles saving 25s idle @ ~0.27 g/s should be roughly 40-70g
    assert 10.0 <= co2_saved <= 200.0


def test_offline_mode_defaults_to_rules_fallback(tmp_path):
    """Verify that when no API key is provided, the dispatcher uses rules fallback."""
    dispatcher = LLMDispatcher(
        api_key="",
        directives_path=tmp_path / "directives.jsonl",
    )
    payload = {
        "intersection_id": "junction_test",
        "timestamp": "2026-10-16T12:00:00Z",
        "idle_ratio": 0.48,
        "n_counted_vehicles": 15,
    }
    directive = dispatcher.dispatch(payload)
    assert directive.mode == "rules_fallback"
    assert directive.intersection_id == "junction_test"


def test_m6_verification_twenty_mock_payloads(tmp_path):
    """M6 Verification Gate: 20 varied mock payloads produce 100% schema-valid directives."""
    dispatcher = LLMDispatcher(
        api_key="",
        directives_path=tmp_path / "directives.jsonl",
    )

    valid_count = 0
    total_payloads = 20

    for i in range(total_payloads):
        mock_payload = {
            "intersection_id": f"junction_{i % 4:02d}",
            "timestamp": f"2026-10-16T12:{i:02d}:00Z",
            "window_s": 60.0,
            "co2_g_total": 450.0 + i * 35.0,
            "co2_g_per_min": 450.0 + i * 35.0,
            "idle_ratio": (i * 0.045) % 0.85,
            "heavy_vehicle_density": (i * 0.02) % 0.35,
            "n_counted_vehicles": 10 + i * 2,
            "n_stop_events": i % 9,
            "top_choke_zone": {
                "id": f"{i % 4}_{i % 4}",
                "idle_vehicle_minutes": (i * 0.6) % 9.0,
            }
            if i % 3 != 0
            else None,
        }

        # Verify against CorridorPayload schema
        validated_payload = CorridorPayload.model_validate(mock_payload)
        assert validated_payload.window_s == 60.0

        # Dispatch
        directive = dispatcher.dispatch(validated_payload)

        # Strict schema assertion
        assert isinstance(directive, Directive)
        assert directive.confidence >= 0.0 and directive.confidence <= 1.0
        assert len(directive.rationale) <= 300
        assert directive.estimated_co2_saved_g >= 0.0
        assert len(directive.actions) >= 1
        valid_count += 1

    assert valid_count == total_payloads


def test_mocked_llm_retry_success(tmp_path):
    """Verify that a malformed first attempt is recovered by the 1-retry mechanism."""
    dispatcher = LLMDispatcher(
        api_key="mock_test_key",
        directives_path=tmp_path / "directives.jsonl",
    )

    bad_json = "NOT_JSON_AT_ALL"
    good_json = json.dumps({
        "actions": [{"type": "extend_green", "lane": "N", "seconds": 12, "target_class": None}],
        "confidence": 0.94,
        "rationale": "High N-S corridor queue buildup dissipated.",
    })

    # First call throws, second call returns good_json
    with patch.object(dispatcher, "_call_llm_raw", side_effect=[bad_json, good_json]):
        payload = {"intersection_id": "junction_retry", "idle_ratio": 0.42}
        directive = dispatcher.dispatch(payload)
        assert directive.mode == "llm"
        assert directive.actions[0].type == ActionType.EXTEND_GREEN
        assert directive.actions[0].seconds == 12
        assert directive.confidence == 0.94


def test_mocked_llm_exhausted_retries_falls_back(tmp_path):
    """Verify that if both LLM attempts fail, dispatcher safely falls back to rules engine."""
    dispatcher = LLMDispatcher(
        api_key="mock_test_key",
        directives_path=tmp_path / "directives.jsonl",
    )

    bad_json = "CORRUPTED_RESPONSE"
    with patch.object(dispatcher, "_call_llm_raw", side_effect=[bad_json, bad_json]):
        payload = {"intersection_id": "junction_fail", "idle_ratio": 0.45}
        directive = dispatcher.dispatch(payload)
        assert directive.mode == "rules_fallback"
        assert directive.actions[0].type == ActionType.EXTEND_GREEN


def test_persistence_to_directives_jsonl(tmp_path):
    """Verify that emitted directives are serialized to append-only JSONL format."""
    directives_file = tmp_path / "directives.jsonl"
    dispatcher = LLMDispatcher(
        api_key="",
        directives_path=directives_file,
    )

    p1 = {"intersection_id": "j1", "idle_ratio": 0.50}
    p2 = {"intersection_id": "j2", "idle_ratio": 0.10}

    dispatcher.dispatch(p1)
    dispatcher.dispatch(p2)

    assert directives_file.exists()
    lines = directives_file.read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == 2

    d1 = Directive.model_validate_json(lines[0])
    d2 = Directive.model_validate_json(lines[1])
    assert d1.intersection_id == "j1"
    assert d2.intersection_id == "j2"
