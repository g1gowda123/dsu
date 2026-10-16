"""Perception package for vehicle detection, tracking, and kinematics."""

from perception.kinematics import (
    DEFAULT_MEAN_LENGTH_M,
    TrackState,
    classify_state,
    load_mean_lengths,
    smooth_speed,
    update_track,
)

__all__ = [
    "DEFAULT_MEAN_LENGTH_M",
    "TrackState",
    "classify_state",
    "load_mean_lengths",
    "smooth_speed",
    "update_track",
    "Tracker",
]


def __getattr__(name: str):
    if name == "Tracker":
        from perception.tracker import Tracker

        return Tracker
    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")
