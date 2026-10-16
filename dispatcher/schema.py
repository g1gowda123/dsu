"""Pydantic v2 schemas for the municipal traffic dispatcher.

Defines the contract between the corridor digital twin, the GenAI dispatcher,
and the frontend municipal command dashboard.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import List, Literal, Optional
import uuid

from pydantic import BaseModel, Field


class ActionType(str, Enum):
    """Permitted signal intervention types."""

    EXTEND_GREEN = "extend_green"
    GREEN_WAVE_PRIORITY = "green_wave_priority"
    HEAVY_VEHICLE_RESTRICTION = "heavy_vehicle_restriction"
    NO_ACTION = "no_action"


class Action(BaseModel):
    """An atomic traffic intervention directive."""

    type: ActionType
    lane: Optional[Literal["N", "S", "E", "W"]] = None
    seconds: Optional[int] = Field(default=None, ge=0, le=15)
    target_class: Optional[
        Literal["car", "motorcycle", "auto_rickshaw", "bus", "truck"]
    ] = None


class Directive(BaseModel):
    """Municipal traffic signal timing directive emitted by dispatcher."""

    directive_id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    intersection_id: str
    actions: List[Action]
    estimated_co2_saved_g: float = Field(..., ge=0.0)
    confidence: float = Field(..., ge=0.0, le=1.0)
    rationale: str = Field(..., max_length=300)
    mode: Literal["llm", "rules_fallback"]


class TopChokeZone(BaseModel):
    """Spatial choke zone identifier and accumulated idle time."""

    id: str
    idle_vehicle_minutes: float = Field(..., ge=0.0)


class CorridorPayload(BaseModel):
    """Telemetry payload contract emitted by corridor digital twin to dispatcher."""

    intersection_id: str
    timestamp: str
    window_s: float = Field(default=60.0, ge=0.0)
    co2_g_total: float = Field(..., ge=0.0)
    co2_g_per_min: float = Field(..., ge=0.0)
    idle_ratio: float = Field(..., ge=0.0, le=1.0)
    heavy_vehicle_density: float = Field(..., ge=0.0, le=1.0)
    n_counted_vehicles: int = Field(..., ge=0)
    n_stop_events: int = Field(..., ge=0)
    top_choke_zone: Optional[TopChokeZone] = None
