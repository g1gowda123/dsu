"""Schema definitions for the municipal traffic carbon dispatcher.

Defines Pydantic models for actions, directives, corridor payloads, and enums.
All emissions math is calculated deterministically in Python — never by the LLM.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field, field_validator, model_validator


class ActionType(str, Enum):
    """Permitted municipal traffic intervention action types."""

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
    """Individual municipal signal or corridor traffic intervention."""

    type: ActionType
    lane: Optional[Lane] = None
    seconds: Optional[int] = Field(None, ge=0, le=15, description="Intervention duration in seconds (0 to 15)")
    target_class: Optional[TargetClass] = Field(None, description="Target vehicle class if intervention is class-specific")

    @model_validator(mode="after")
    def validate_action_fields(self) -> Action:
        """Validate logical relationships between action types and attributes."""
        if self.type == ActionType.NO_ACTION:
            # seconds and lane are optional/ignored for no_action
            pass
        elif self.type == ActionType.EXTEND_GREEN:
            if self.seconds is None:
                self.seconds = 10
        elif self.type == ActionType.HEAVY_VEHICLE_RESTRICTION:
            if self.target_class is None:
                self.target_class = TargetClass.TRUCK
        return self


class TopChokeZone(BaseModel):
    """Identification and metrics of the leading spatial choke zone."""

    id: str
    idle_vehicle_minutes: float = Field(..., ge=0.0)


class CorridorPayload(BaseModel):
    """Input payload generated from 60s corridor telemetry aggregates."""

    intersection_id: str
    timestamp: str
    window_s: float = Field(60.0, ge=1.0)
    co2_g_total: float = Field(0.0, ge=0.0)
    co2_g_per_min: float = Field(0.0, ge=0.0)
    idle_ratio: float = Field(0.0, ge=0.0, le=1.0)
    heavy_vehicle_density: float = Field(0.0, ge=0.0, le=1.0)
    n_counted_vehicles: int = Field(0, ge=0)
    n_stop_events: int = Field(0, ge=0)
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


class Directive(BaseModel):
    """Full municipal dispatcher directive record persisted to directives.jsonl."""

    timestamp: str
    intersection_id: str
    actions: List[Action] = Field(default_factory=list)
    estimated_co2_saved_g: float = Field(..., ge=0.0, description="Deterministic Python-calculated CO2 grams saved")
    confidence: float = Field(..., ge=0.0, le=1.0)
    rationale: str = Field(..., max_length=300)
    mode: Literal["llm", "rules_fallback"]

    @field_validator("rationale", mode="before")
    @classmethod
    def truncate_rationale(cls, v: Any) -> Any:
        """Ensure rationale is capped at 300 characters."""
        if isinstance(v, str) and len(v) > 300:
            return v[:297] + "..."
        return v
