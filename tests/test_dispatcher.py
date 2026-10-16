"""Tests for GenAI Municipal Dispatcher and Non-Negotiable Guardrails."""

from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from typing import Any, Dict
from unittest.mock import patch
import numpy as np
import pytest
from pydantic import ValidationError
import yaml

# Ensure project root is in sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from dispatcher.llm_dispatcher import LLMDispatcher, LLMProposal, dispatch
from dispatcher.rules_fallback import (
    compute_deterministic_co2_saved,
    generate_fallback_directive,
    rules_fallback,
)
from dispatcher.schema import (
    Action,
    ActionType,
    CorridorPayload,
    Directive,
    Lane,
    TargetClass,
    TopChokeZone,
)
from twin.scenarios import compute_action_savings


@pytest.fixture
def emission_factors() -> Dict[str, Any]:
    config_path = REPO_ROOT / "config" / "emission_factors.yaml"
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


@pytest.fixture
def sample_payload() -> CorridorPayload:
    return CorridorPayload(
        intersection_id="junction_01",
        timestamp=datetime.now(timezone.utc).isoformat(),
        window_s=60.0,
        co2_g_total=180.0,
        co2_g_per_min=180.0,
        idle_ratio=0.48,
        heavy_vehicle_density=0.12,
        n_counted_vehicles=24,
        n_stop_events=5,
        top_choke_zone=TopChokeZone(id="z_r1_c2", idle_vehicle_minutes=6.0),
    )


def test_guardrail_llm_cannot_inject_carbon(sample_payload, emission_factors, tmp_path):
    """GUARDRAIL 2 PROOF: LLM injects estimated_co2_saved_g=999999.

    Assert that the emitted Directive ignores/discards the 999999 value
    and strictly uses the Python-calculated carbon savings.
    """
    log_file = tmp_path / "directives.jsonl"

    def mock_adversarial_llm(prompt: str) -> str:
        return json.dumps({
            "type": "extend_green",
            "lane": "N",
            "seconds": 10,
            "target_class": None,
            "confidence": 0.95,
            "rationale": "Adversarial LLM claims massive carbon savings.",
            "estimated_co2_saved_g": 999999.0,
            "saved_carbon_kg": 500.0,
        })

    directive = dispatch(
        payload=sample_payload,
        factors=emission_factors,
        call_llm_fn=mock_adversarial_llm,
        directives_log_path=log_file,
    )

    assert isinstance(directive, Directive)
    assert directive.mode == "llm"
    assert directive.estimated_co2_saved_g != 999999.0

    expected_savings = compute_action_savings(
        actions=directive.actions,
        factors=emission_factors,
        payload=sample_payload,
    )
    assert directive.estimated_co2_saved_g == expected_savings
    assert directive.estimated_co2_saved_g > 0.0


def test_corrupted_schema_falls_back_to_rules(sample_payload, emission_factors, tmp_path):
    """Verify that corrupt JSON or illegal action enums cleanly trigger rules_fallback."""
    log_file = tmp_path / "directives.jsonl"

    def mock_corrupt_llm(prompt: str) -> str:
        return '{"type": "teleport_vehicles", "confidence": "high", "rationale": 123}'

    directive = dispatch(
        payload=sample_payload,
        factors=emission_factors,
        call_llm_fn=mock_corrupt_llm,
        directives_log_path=log_file,
    )

    assert isinstance(directive, Directive)
    assert directive.mode == "rules_fallback"
    assert directive.confidence == 0.85
    assert directive.actions[0].type == ActionType.EXTEND_GREEN


def test_timeout_or_network_failure_falls_back(sample_payload, emission_factors, tmp_path):
    """Verify network exceptions or timeout trigger rules_fallback cleanly."""
    log_file = tmp_path / "directives.jsonl"

    def mock_timeout_llm(prompt: str) -> str:
        raise TimeoutError("LLM call exceeded 8.0s limit")

    directive = dispatch(
        payload=sample_payload,
        factors=emission_factors,
        call_llm_fn=mock_timeout_llm,
        directives_log_path=log_file,
    )

    assert isinstance(directive, Directive)
    assert directive.mode == "rules_fallback"
    assert directive.confidence == 0.85


def test_retry_mechanism_recovers(sample_payload, emission_factors, tmp_path):
    """Verify retry recovers on second attempt if first attempt fails."""
    log_file = tmp_path / "directives.jsonl"
    attempts = 0

    def mock_flaky_llm(prompt: str) -> str:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return "Not valid JSON at all"
        return json.dumps({
            "type": "extend_green",
            "lane": "S",
            "seconds": 8,
            "target_class": None,
            "confidence": 0.89,
            "rationale": "Queue cleared after 1 retry.",
        })

    directive = dispatch(
        payload=sample_payload,
        factors=emission_factors,
        call_llm_fn=mock_flaky_llm,
        directives_log_path=log_file,
    )

    assert attempts == 2
    assert directive.mode == "llm"
    assert directive.actions[0].lane == "S"
    assert directive.actions[0].seconds == 8


def test_offline_flag_forces_rules_fallback(sample_payload, emission_factors, tmp_path):
    """Verify --offline flag immediately invokes rules_fallback."""
    log_file = tmp_path / "directives.jsonl"

    called = False

    def mock_llm_should_not_be_called(prompt: str) -> str:
        nonlocal called
        called = True
        return "{}"

    directive = dispatch(
        payload=sample_payload,
        factors=emission_factors,
        offline=True,
        call_llm_fn=mock_llm_should_not_be_called,
        directives_log_path=log_file,
    )

    assert not called
    assert directive.mode == "rules_fallback"


def test_no_api_key_set_produces_valid_directives_across_20_payloads(
    monkeypatch, emission_factors, tmp_path
):
    """Verify no API key set in env produces 100% schema-valid directives in rules_fallback mode."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    log_file = tmp_path / "directives.jsonl"
    rng = np.random.default_rng(123)

    for i in range(20):
        idle_r = float(rng.uniform(0.05, 0.65))
        heavy_d = float(rng.uniform(0.02, 0.30))
        n_stops = int(rng.integers(0, 8))
        idle_m = float(rng.uniform(0.5, 7.5))
        r = int(rng.integers(0, 4))
        c = int(rng.integers(0, 4))

        payload = CorridorPayload(
            intersection_id=f"junction_{i:02d}",
            timestamp=datetime.now(timezone.utc).isoformat(),
            window_s=60.0,
            co2_g_total=float(round(rng.uniform(40.0, 250.0), 2)),
            co2_g_per_min=float(round(rng.uniform(40.0, 250.0), 2)),
            idle_ratio=round(idle_r, 4),
            heavy_vehicle_density=round(heavy_d, 4),
            n_counted_vehicles=int(rng.integers(10, 40)),
            n_stop_events=n_stops,
            top_choke_zone=TopChokeZone(
                id=f"z_r{r}_c{c}",
                idle_vehicle_minutes=round(idle_m, 2),
            ),
        )

        directive = dispatch(
            payload=payload,
            factors=emission_factors,
            directives_log_path=log_file,
        )

        assert isinstance(directive, Directive)
        assert directive.mode == "rules_fallback"
        assert len(directive.directive_id) == 32
        assert len(directive.rationale) <= 300
        assert directive.estimated_co2_saved_g >= 0.0

    with open(log_file, "r", encoding="utf-8") as f:
        lines = [line.strip() for line in f if line.strip()]
    assert len(lines) == 20


# Additional test coverage from parallel teammate work
def test_schema_bounds_enforcement():
    with pytest.raises(ValidationError):
        Action(type=ActionType.EXTEND_GREEN, seconds=25)


def test_schema_rationale_truncation():
    long_rationale = "A" * 350
    proposal = LLMProposal(
        type=ActionType.NO_ACTION,
        confidence=0.8,
        rationale=long_rationale,
    )
    assert len(proposal.rationale) <= 300
    assert proposal.rationale.endswith("...")


def test_rules_fallback_high_idle_choke():
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
    assert len(directive.actions) >= 1
    action_types = {a.type for a in directive.actions}
    assert ActionType.HEAVY_VEHICLE_RESTRICTION in action_types
    assert directive.estimated_co2_saved_g > 0.0


def test_rules_fallback_nominal_traffic():
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


def test_deterministic_co2_math_consistency(emission_factors):
    actions = [Action(type=ActionType.EXTEND_GREEN, lane=Lane.N, seconds=10)]
    payload = {
        "n_counted_vehicles": 20,
        "idle_ratio": 0.45,
        "heavy_vehicle_density": 0.10,
    }
    co2_saved = compute_deterministic_co2_saved(actions, payload, factors=emission_factors)
    assert 5.0 <= co2_saved <= 200.0


def test_mocked_llm_exhausted_retries_falls_back(tmp_path):
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
