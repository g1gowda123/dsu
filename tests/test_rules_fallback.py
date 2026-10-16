"""Tests for deterministic rules fallback engine."""

from datetime import datetime, timezone
from pathlib import Path
import sys
import pytest
import numpy as np
import pandas as pd
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dispatcher.rules_fallback import rules_fallback
from dispatcher.schema import ActionType, CorridorPayload, Directive, TopChokeZone
from twin.scenarios import apply_scenario
from scripts.make_synthetic_telemetry import generate_synthetic_telemetry
from twin.emission_engine import compute_track_emissions


@pytest.fixture
def emission_factors() -> dict:
    config_path = Path(__file__).parent.parent / "config" / "emission_factors.yaml"
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def test_rules_fallback_20_synthetic_payloads(emission_factors):
    """Generate 20 varied synthetic payloads; assert valid Directive and no_action -> 0.0 savings."""
    rng = np.random.default_rng(42)

    for i in range(20):
        idle_ratio = float(rng.uniform(0.05, 0.70))
        heavy_density = float(rng.uniform(0.02, 0.35))
        n_stops = int(rng.integers(0, 10))
        idle_min = float(rng.uniform(0.5, 8.0))
        r = int(rng.integers(0, 4))
        c = int(rng.integers(0, 4))

        payload = CorridorPayload(
            intersection_id=f"junction_{i:02d}",
            timestamp=datetime.now(timezone.utc).isoformat(),
            window_s=60.0,
            co2_g_total=float(round(rng.uniform(50.0, 300.0), 2)),
            co2_g_per_min=float(round(rng.uniform(50.0, 300.0), 2)),
            idle_ratio=round(idle_ratio, 4),
            heavy_vehicle_density=round(heavy_density, 4),
            n_counted_vehicles=int(rng.integers(10, 50)),
            n_stop_events=n_stops,
            top_choke_zone=TopChokeZone(
                id=f"z_r{r}_c{c}",
                idle_vehicle_minutes=round(idle_min, 2),
            ),
        )

        directive = rules_fallback(payload, factors=emission_factors)

        # Basic contract assertions
        assert isinstance(directive, Directive)
        assert directive.mode == "rules_fallback"
        assert directive.confidence == 0.85
        assert len(directive.rationale) <= 300
        assert directive.estimated_co2_saved_g >= 0.0

        # Assert no_action -> exactly 0.0 savings
        if any(a.type == ActionType.NO_ACTION for a in directive.actions):
            assert directive.estimated_co2_saved_g == 0.0, (
                f"Payload {i} produced NO_ACTION but savings was {directive.estimated_co2_saved_g}"
            )


def test_rules_fallback_congestion_triggers(emission_factors):
    """Test explicit trigger for high idle_ratio or high idle_vehicle_minutes."""
    # Case A: idle_ratio > 0.40
    p_idle = CorridorPayload(
        intersection_id="junction_01",
        timestamp=datetime.now(timezone.utc).isoformat(),
        co2_g_total=150.0,
        co2_g_per_min=150.0,
        idle_ratio=0.45,
        heavy_vehicle_density=0.08,
        n_counted_vehicles=20,
        n_stop_events=4,
        top_choke_zone=TopChokeZone(id="z_r0_c1", idle_vehicle_minutes=3.0),
    )
    dir_a = rules_fallback(p_idle, factors=emission_factors)
    assert dir_a.actions[0].type == ActionType.EXTEND_GREEN
    assert dir_a.actions[0].seconds in (8, 10, 12)
    assert dir_a.actions[0].lane in ("N", "S", "E", "W")
    assert dir_a.estimated_co2_saved_g > 0.0

    # Case B: idle_vehicle_minutes > 5.0
    p_dwell = CorridorPayload(
        intersection_id="junction_01",
        timestamp=datetime.now(timezone.utc).isoformat(),
        co2_g_total=150.0,
        co2_g_per_min=150.0,
        idle_ratio=0.30,  # Below 0.40
        heavy_vehicle_density=0.05,
        n_counted_vehicles=20,
        n_stop_events=5,
        top_choke_zone=TopChokeZone(id="z_r3_c2", idle_vehicle_minutes=6.2),
    )
    dir_b = rules_fallback(p_dwell, factors=emission_factors)
    assert dir_b.actions[0].type == ActionType.EXTEND_GREEN
    assert dir_b.actions[0].lane == "S"
    assert dir_b.estimated_co2_saved_g > 0.0


def test_rules_fallback_heavy_density_trigger(emission_factors):
    """Test heavy_vehicle_density > 0.15 and stop events >= 3."""
    p_heavy = CorridorPayload(
        intersection_id="junction_01",
        timestamp=datetime.now(timezone.utc).isoformat(),
        co2_g_total=220.0,
        co2_g_per_min=220.0,
        idle_ratio=0.25,
        heavy_vehicle_density=0.22,
        n_counted_vehicles=30,
        n_stop_events=4,
        top_choke_zone=TopChokeZone(id="z_r1_c0", idle_vehicle_minutes=2.5),
    )
    dir_heavy = rules_fallback(p_heavy, factors=emission_factors)
    action_types = {a.type for a in dir_heavy.actions}
    assert ActionType.HEAVY_VEHICLE_RESTRICTION in action_types or ActionType.GREEN_WAVE_PRIORITY in action_types
    assert dir_heavy.estimated_co2_saved_g > 0.0


def test_rules_fallback_nominal_no_action(emission_factors):
    """Test nominal condition -> NO_ACTION and 0.0 savings."""
    p_nominal = CorridorPayload(
        intersection_id="junction_01",
        timestamp=datetime.now(timezone.utc).isoformat(),
        co2_g_total=80.0,
        co2_g_per_min=80.0,
        idle_ratio=0.15,
        heavy_vehicle_density=0.05,
        n_counted_vehicles=15,
        n_stop_events=1,
        top_choke_zone=TopChokeZone(id="z_r1_c1", idle_vehicle_minutes=1.2),
    )
    d = rules_fallback(p_nominal, factors=emission_factors)
    assert d.actions[0].type == ActionType.NO_ACTION
    assert d.estimated_co2_saved_g == 0.0


def test_savings_reused_from_scenarios_math(emission_factors):
    """CRITICAL: Assert directive estimated_co2_saved_g matches apply_scenario output exactly."""
    df = generate_synthetic_telemetry(duration_s=120.0, n_vehicles=30, seed=42)
    emitted = compute_track_emissions(df, emission_factors, min_age=15)

    payload = CorridorPayload(
        intersection_id="junction_01",
        timestamp=datetime.now(timezone.utc).isoformat(),
        co2_g_total=500.0,
        co2_g_per_min=250.0,
        idle_ratio=0.48,  # Triggers extend_green (10s)
        heavy_vehicle_density=0.10,
        n_counted_vehicles=30,
        n_stop_events=5,
        top_choke_zone=TopChokeZone(id="z_r0_c2", idle_vehicle_minutes=6.5),
    )

    # Calling rules_fallback with df
    directive = rules_fallback(payload, df=emitted, factors=emission_factors)
    assert directive.actions[0].type == ActionType.EXTEND_GREEN
    chosen_sec = directive.actions[0].seconds

    # Cross-check directly against What-If simulator output
    scenario_res = apply_scenario(
        df=emitted,
        factors=emission_factors,
        ev_share={},
        green_extension_s=chosen_sec,
        heavy_restriction=False,
    )

    assert directive.estimated_co2_saved_g == scenario_res["avoided_g"], (
        f"Mismatch: Directive={directive.estimated_co2_saved_g} vs Scenario={scenario_res['avoided_g']}"
    )
