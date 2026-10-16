"""LLM-driven schema-constrained municipal traffic dispatcher.

Orchestrates municipal signal timing interventions using Gemini with strict schema
validation, automatic rules-fallback, and deterministic Python carbon accounting.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Union
import yaml

from dotenv import load_dotenv

from dispatcher.rules_fallback import (
    compute_deterministic_co2_saved,
    generate_fallback_directive,
    load_emission_factors,
)
from dispatcher.schema import (
    Action,
    ActionType,
    CorridorPayload,
    Directive,
    Lane,
    LLMActionChoice,
    TargetClass,
)

logger = logging.getLogger("dispatcher")

# Load environment variables from .env
REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(REPO_ROOT / ".env")

DEFAULT_APP_CONFIG_PATH = REPO_ROOT / "config" / "app.yaml"
DEFAULT_DIRECTIVES_PATH = REPO_ROOT / "artifacts" / "directives.jsonl"

SYSTEM_PROMPT = """You are an edge municipal traffic carbon dispatcher for an Indian urban intersection.
Your objective is to issue traffic interventions that minimize corridor idling and reduce vehicular CO2 emissions.

NON-NEGOTIABLE GUARDRAIL:
You MUST NEVER compute emissions, grams of CO2, or fuel savings. All carbon math is computed deterministically in Python.
You only decide the intervention actions, confidence, and a concise municipal audit rationale (<= 300 characters).

Available Actions:
- "extend_green": Extends green phase (0-15s) on congested approach ("N", "S", "E", "W") to clear queue discharge.
- "green_wave_priority": Grants progressive coordination (0-15s) for approaching platoons or transit fleets.
- "heavy_vehicle_restriction": Meters or holds heavy diesel idlers (target_class: "bus" or "truck") from entering gridlocked choke zones.
- "no_action": Used when corridor traffic is operating nominally without severe choke buildup.

Output MUST be strictly valid JSON matching this schema:
{
  "actions": [
    {
      "type": "extend_green" | "green_wave_priority" | "heavy_vehicle_restriction" | "no_action",
      "lane": "N" | "S" | "E" | "W" | null,
      "seconds": 0 to 15,
      "target_class": "car" | "motorcycle" | "auto_rickshaw" | "bus" | "truck" | null
    }
  ],
  "confidence": 0.0 to 1.0,
  "rationale": "Short explanation under 300 chars"
}
"""


def _load_app_config(config_path: Optional[Union[str, Path]] = None) -> Dict[str, Any]:
    """Load dispatcher settings from config/app.yaml."""
    path = Path(config_path) if config_path else DEFAULT_APP_CONFIG_PATH
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f)
            if isinstance(cfg, dict):
                return cfg
    return {
        "dispatcher": {
            "trigger_interval_twin_s": 30,
            "llm_provider": "gemini",
            "model_name": "gemini-2.0-flash",
        }
    }


class LLMDispatcher:
    """Schema-constrained LLM dispatcher with guaranteed fallback and deterministic carbon math."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: Optional[str] = None,
        app_config_path: Optional[Union[str, Path]] = None,
        directives_path: Optional[Union[str, Path]] = None,
    ):
        self.app_cfg = _load_app_config(app_config_path)
        dispatcher_cfg = self.app_cfg.get("dispatcher", {})

        self.model_name = model_name or dispatcher_cfg.get("model_name", "gemini-2.0-flash")
        self.api_key = api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        self.directives_path = Path(directives_path) if directives_path else DEFAULT_DIRECTIVES_PATH
        self.emission_cfg = load_emission_factors()

        self._client = None
        if self.api_key and self.api_key != "your_key_here":
            try:
                from google import genai
                self._client = genai.Client(api_key=self.api_key)
            except Exception as e:
                logger.warning(f"Failed to initialize Gemini Client: {e}. Defaulting to rules fallback.")
                self._client = None

    def _call_llm_raw(self, user_prompt: str) -> str:
        """Execute raw LLM inference via google.genai Client."""
        if not self._client:
            raise RuntimeError("LLM client not configured or missing API key.")

        response = self._client.models.generate_content(
            model=self.model_name,
            contents=[SYSTEM_PROMPT, user_prompt],
        )
        return response.text or ""

    def _parse_and_validate(self, raw_text: str) -> LLMActionChoice:
        """Extract and validate JSON against LLMActionChoice schema."""
        cleaned = raw_text.strip()
        # Strip markdown fences if present
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            cleaned = "\n".join(lines).strip()

        data = json.loads(cleaned)
        return LLMActionChoice.model_validate(data)

    def dispatch(
        self,
        payload: Union[CorridorPayload, Dict[str, Any]],
        persist: bool = True,
    ) -> Directive:
        """Process corridor telemetry payload and issue a verified municipal directive.

        Execution Pipeline:
          1. Check for API key / client availability. If unavailable, invoke rules_fallback.
          2. Execute LLM call with strict JSON constraint.
          3. Validate schema. If invalid, attempt 1 retry.
          4. If retry fails or exception occurs, fall back to rules_fallback.
          5. Compute avoided CO2 grams deterministically in Python.
          6. Persist directive record to artifacts/directives.jsonl.
        """
        if isinstance(payload, CorridorPayload):
            p_dict = payload.model_dump()
        else:
            p_dict = dict(payload)

        intersection_id = str(p_dict.get("intersection_id", "junction_01"))
        timestamp = p_dict.get("timestamp") or datetime.now(timezone.utc).isoformat()

        # Step 1: Check offline / fallback condition
        if not self._client:
            logger.info("No Gemini API key detected. Triggering rules_fallback mode.")
            directive = generate_fallback_directive(p_dict, self.emission_cfg)
            if persist:
                self.append_directive(directive)
            return directive

        # Step 2: Format prompt
        user_prompt = f"Corridor Telemetry Snapshot:\n{json.dumps(p_dict, indent=2)}\n\nDetermine intervention JSON:"

        choice: Optional[LLMActionChoice] = None
        attempt_error: Optional[str] = None

        # Step 3: Attempt 1 + 1 retry
        for attempt in range(2):
            try:
                curr_prompt = user_prompt
                if attempt > 0 and attempt_error:
                    curr_prompt += f"\n\nPrevious attempt had error: {attempt_error}. Please provide strictly valid JSON."

                raw_text = self._call_llm_raw(curr_prompt)
                choice = self._parse_and_validate(raw_text)
                break
            except Exception as e:
                attempt_error = str(e)
                logger.warning(f"LLM dispatcher attempt {attempt + 1} failed: {e}")

        # Step 4: If LLM failed, use rules fallback
        if choice is None:
            logger.warning("LLM dispatcher retry exhausted. Falling back to deterministic rules engine.")
            directive = generate_fallback_directive(p_dict, self.emission_cfg)
            if persist:
                self.append_directive(directive)
            return directive

        # Step 5: Post-validation Python deterministic emissions calculation
        co2_saved = compute_deterministic_co2_saved(choice.actions, p_dict, self.emission_cfg)

        directive = Directive(
            timestamp=str(timestamp),
            intersection_id=intersection_id,
            actions=choice.actions,
            estimated_co2_saved_g=co2_saved,
            confidence=float(round(choice.confidence, 2)),
            rationale=choice.rationale[:300],
            mode="llm",
        )

        # Step 6: Persist
        if persist:
            self.append_directive(directive)

        return directive

    def append_directive(self, directive: Directive) -> None:
        """Append directive record to artifacts/directives.jsonl."""
        try:
            self.directives_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.directives_path, "a", encoding="utf-8") as f:
                f.write(directive.model_dump_json() + "\n")
        except Exception as e:
            logger.error(f"Failed to append to {self.directives_path}: {e}")


def dispatch(
    payload: Union[CorridorPayload, Dict[str, Any]],
    persist: bool = True,
    api_key: Optional[str] = None,
) -> Directive:
    """Convenience module function to process a telemetry payload."""
    dispatcher_instance = LLMDispatcher(api_key=api_key)
    return dispatcher_instance.dispatch(payload, persist=persist)
