"""Pydantic v2 schemas for the municipal traffic carbon dispatcher.

Defines the contract between the corridor digital twin, the GenAI dispatcher,
and the frontend municipal command dashboard.
All emissions math is calculated deterministically in Python — never by the LLM.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union
import uuid

from pydantic import BaseModel, Field, field_validator, model_validator


class ActionType(str, Enum):
    """Permitted signal intervention types."""

    EXTEND_GREEN = "extend_green"
    GREEN_WAVE_PRIORITY = "green_wave_priority"
    HEAVY_VEHICLE_RESTRICTION = "heavy_vehicle_restriction"
    NO_ACTION = "no_action"


class Lane(str, Enum):
    """Directional approach lanes at an intersection."""

    N = "N"
    S = "S"
    E = "E"
    W = "W"


class TargetClass(str, Enum):
    """Permitted vehicle taxonomy classes for targeted intervention."""

    CAR = "car"
    MOTORCYCLE = "motorcycle"
    AUTO_RICKSHAW = "auto_rickshaw"
    BUS = "bus"
    TRUCK = "truck"


class Action(BaseModel):
    """An atomic traffic intervention directive."""

    type: ActionType
    lane: Optional[Union[Lane, Literal["N", "S", "E", "W"]]] = None
    seconds: Optional[int] = Field(default=None, ge=0, le=15)
    target_class: Optional[
        Union[TargetClass, Literal["car", "motorcycle", "auto_rickshaw", "bus", "truck"]]
    ] = None

    @model_validator(mode="after")
    def validate_action_fields(self) -> Action:
        """Validate logical defaults between action types and attributes."""
        if self.type == ActionType.NO_ACTION:
            pass
        elif self.type == ActionType.EXTEND_GREEN and self.seconds is None:
            self.seconds = 10
        elif self.type == ActionType.HEAVY_VEHICLE_RESTRICTION and self.target_class is None:
            self.target_class = TargetClass.TRUCK
        return self


class Directive(BaseModel):
    """Municipal traffic signal timing directive emitted by dispatcher."""

    directive_id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    intersection_id: str
    actions: List[Action] = Field(default_factory=list)
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

    intersection_id: str = "junction_01"
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    window_s: float = Field(default=60.0, ge=0.0)
    co2_g_total: float = Field(default=0.0, ge=0.0)
    co2_g_per_min: float = Field(default=0.0, ge=0.0)
    idle_ratio: float = Field(default=0.0, ge=0.0, le=1.0)
    heavy_vehicle_density: float = Field(default=0.0, ge=0.0, le=1.0)
    n_counted_vehicles: int = Field(default=0, ge=0)
    n_stop_events: int = Field(default=0, ge=0)
    top_choke_zone: Optional[TopChokeZone] = None


class LLMActionChoice(BaseModel):
    """Action output structure expected from LLM before python post-processing."""

    actions: List[Action] = Field(default_factory=lambda: [Action(type=ActionType.NO_ACTION)])
    confidence: float = Field(..., ge=0.0, le=1.0, description="Decision confidence score between 0.0 and 1.0")
    rationale: str = Field(..., max_length=300, description="Concise rationale for municipal audit (max 300 chars)")

    @field_validator("rationale", mode="before")
    @classmethod
    def truncate_rationale(cls, v: Any) -> Any:
        """Ensure rationale is capped at 300 characters."""
        if isinstance(v, str) and len(v) > 300:
            return v[:297] + "..."
        return v


class LLMProposal(BaseModel):
    """Schema for LLM signal timing proposal.

    CRITICAL GUARDRAIL:
    This model contains ONLY signal action parameters and qualitative rationale.
    It contains NO numeric carbon or savings fields, making it structurally
    impossible for the LLM to output or inject emissions figures.
    """

    model_config = {"extra": "ignore"}

    type: ActionType = ActionType.NO_ACTION
    lane: Optional[Union[Lane, Literal["N", "S", "E", "W"]]] = None
    seconds: Optional[int] = Field(default=None, ge=0, le=15)
    target_class: Optional[
        Union[TargetClass, Literal["car", "motorcycle", "auto_rickshaw", "bus", "truck"]]
    ] = None
    confidence: float = Field(..., ge=0.0, le=1.0)
    rationale: str = Field(..., max_length=300)
    actions: Optional[List[Action]] = None

    @field_validator("rationale", mode="before")
    @classmethod
    def truncate_rationale(cls, v: Any) -> Any:
        if isinstance(v, str) and len(v) > 300:
            return v[:297] + "..."
        return v
