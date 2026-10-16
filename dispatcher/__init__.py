"""Municipal Traffic Carbon Dispatcher Module.

Schema-constrained LLM intelligence, deterministic rules fallback, and Pydantic contracts
for municipal signal timing interventions and corridor carbon mitigation.
"""

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
from dispatcher.llm_dispatcher import (
    LLMDispatcher,
    dispatch,
)

__all__ = [
    "Action",
    "ActionType",
    "CorridorPayload",
    "Directive",
    "Lane",
    "LLMActionChoice",
    "TargetClass",
    "TopChokeZone",
    "compute_deterministic_co2_saved",
    "generate_fallback_directive",
    "load_emission_factors",
    "LLMDispatcher",
    "dispatch",
]
