"""GenAI Municipal Traffic Signal Dispatcher with Deterministic Carbon Injected.

Provides schema-constrained LLM advisory for traffic signal timing and corridor policy.
Non-negotiable Guardrail: The LLM NEVER computes carbon figures or emissions math.
All emissions math is calculated in Python using CPCB/BS-VI factors.
Automatic fallback to rules_fallback on timeout (>8s), invalid schema, or offline mode.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
from typing import Any, Callable, Dict, List, Literal, Optional, Union
import httpx
from pydantic import BaseModel, Field, ValidationError
import yaml

# Ensure project root is in sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(REPO_ROOT / ".env")
except ImportError:
    pass

from dispatcher.rules_fallback import rules_fallback
from dispatcher.schema import Action, ActionType, CorridorPayload, Directive, LLMProposal
from twin.scenarios import compute_action_savings

DEFAULT_DIRECTIVES_LOG = REPO_ROOT / "artifacts" / "directives.jsonl"
DEFAULT_FACTORS_PATH = REPO_ROOT / "config" / "emission_factors.yaml"
DEFAULT_APP_CONFIG = REPO_ROOT / "config" / "app.yaml"

SYSTEM_PROMPT = """You are an edge municipal traffic dispatcher at a signalized intersection.
Given the 60-second corridor telemetry aggregate, propose a single signal timing intervention or corridor policy.

PERMITTED ACTIONS:
- extend_green (seconds: 1-15, specify lane: N/S/E/W)
- green_wave_priority (seconds: 1-15, specify lane and optional target_class: bus/truck/car/motorcycle/auto_rickshaw)
- heavy_vehicle_restriction (seconds: 1-15, specify lane and target_class: bus/truck)
- no_action (if traffic flow is nominal or balanced)

CRITICAL NON-NEGOTIABLE RULES:
1. Provide a concise engineering rationale <= 300 characters.
2. DO NOT output or compute any numerical carbon figures, grams of CO2, fuel figures, or emission calculations. Carbon accounting is strictly handled in Python by the deterministic digital twin.
3. Output strictly valid JSON matching this structure:
{
  "type": "extend_green" | "green_wave_priority" | "heavy_vehicle_restriction" | "no_action",
  "lane": "N" | "S" | "E" | "W" | null,
  "seconds": <integer 0-15 or null>,
  "target_class": "car" | "motorcycle" | "auto_rickshaw" | "bus" | "truck" | null,
  "confidence": <float 0.0 to 1.0>,
  "rationale": "<string up to 300 characters>"
}"""


def _load_config(config_path: Optional[Union[str, Path]] = None) -> Dict[str, Any]:
    path = Path(config_path) if config_path else DEFAULT_APP_CONFIG
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    return {}


def _load_factors(factors_path: Optional[Union[str, Path]] = None) -> Dict[str, Any]:
    path = Path(factors_path) if factors_path else DEFAULT_FACTORS_PATH
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    return {}


def append_directive_to_log(
    directive: Directive,
    log_path: Union[str, Path] = DEFAULT_DIRECTIVES_LOG,
) -> None:
    """Append a validated Directive record to JSONL log."""
    path = Path(log_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(directive.model_dump_json() + "\n")


def _extract_json_block(text: str) -> str:
    """Extract JSON object from LLM response text (handles markdown code fences)."""
    text = text.strip()
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    match_braces = re.search(r"(\{.*\})", text, re.DOTALL)
    if match_braces:
        return match_braces.group(1).strip()
    return text


def _call_gemini_api(
    prompt: str,
    api_key: str,
    model_name: str = "gemini-2.0-flash",
    timeout_s: float = 8.0,
) -> str:
    """Call Google Gemini generateContent REST API."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
    payload = {
        "contents": [{"parts": [{"text": f"{SYSTEM_PROMPT}\n\nCORRIDOR TELEMETRY PAYLOAD:\n{prompt}"}]}],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json",
        },
    }
    with httpx.Client(timeout=timeout_s) as client:
        response = client.post(url, json=payload)
        response.raise_for_status()
        data = response.json()
        parts = data["candidates"][0]["content"]["parts"]
        return parts[0]["text"]


def _call_openai_api(
    prompt: str,
    api_key: str,
    model_name: str = "gpt-4o-mini",
    timeout_s: float = 8.0,
) -> str:
    """Call OpenAI Chat Completions REST API."""
    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }
    with httpx.Client(timeout=timeout_s) as client:
        response = client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


def call_llm(
    prompt: str,
    provider: str = "gemini",
    model_name: Optional[str] = None,
    api_key: Optional[str] = None,
    timeout_s: float = 8.0,
) -> str:
    """Route LLM prompt to configured provider."""
    provider_lower = (provider or "gemini").lower()

    if provider_lower in ("gemini", "google"):
        key = api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not key:
            raise ValueError("No Gemini API key found in environment.")
        return _call_gemini_api(
            prompt=prompt,
            api_key=key,
            model_name=model_name or "gemini-2.0-flash",
            timeout_s=timeout_s,
        )

    if provider_lower in ("openai", "gpt"):
        key = api_key or os.getenv("OPENAI_API_KEY")
        if not key:
            raise ValueError("No OpenAI API key found in environment.")
        return _call_openai_api(
            prompt=prompt,
            api_key=key,
            model_name=model_name or "gpt-4o-mini",
            timeout_s=timeout_s,
        )

    try:
        import litellm
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]
        resp = litellm.completion(
            model=model_name or "gemini/gemini-2.0-flash",
            messages=messages,
            timeout=timeout_s,
            response_format={"type": "json_object"},
        )
        return resp.choices[0].message.content
    except Exception as exc:
        raise RuntimeError(f"Unsupported provider {provider}: {exc}") from exc


def dispatch(
    payload: Union[CorridorPayload, Dict[str, Any]],
    df: Optional[Any] = None,
    factors: Optional[Dict[str, Any]] = None,
    offline: bool = False,
    call_llm_fn: Optional[Callable[[str], str]] = None,
    directives_log_path: Optional[Union[str, Path]] = DEFAULT_DIRECTIVES_LOG,
    config_path: Optional[Union[str, Path]] = None,
    api_key: Optional[str] = None,
) -> Directive:
    """Process corridor payload and produce a validated Directive.

    Steps:
      1. If offline or no API key, invoke rules_fallback immediately.
      2. Call LLM with 8s timeout and system prompt (1 retry on validation failure).
      3. Parse into LLMProposal (rejects/ignores any LLM carbon claims).
      4. Inject Python-computed estimated_co2_saved_g via twin scenarios math.
      5. Construct Directive(mode="llm").
      6. Append to artifacts/directives.jsonl.
      7. Return Directive.
    """
    if isinstance(payload, dict):
        corridor_payload = CorridorPayload(**payload)
    else:
        corridor_payload = payload

    factors_dict = factors if factors is not None else _load_factors()
    app_cfg = _load_config(config_path)
    disp_cfg = app_cfg.get("dispatcher", {})

    provider = disp_cfg.get("llm_provider", "gemini")
    model_name = disp_cfg.get("model_name", "gemini-2.0-flash")

    if offline:
        directive = rules_fallback(corridor_payload, df=df, factors=factors_dict)
        if directives_log_path:
            append_directive_to_log(directive, directives_log_path)
        return directive

    effective_key = (
        api_key
        or os.getenv("GEMINI_API_KEY")
        or os.getenv("GOOGLE_API_KEY")
        or os.getenv("OPENAI_API_KEY")
    )
    if not effective_key and call_llm_fn is None:
        directive = rules_fallback(corridor_payload, df=df, factors=factors_dict)
        if directives_log_path:
            append_directive_to_log(directive, directives_log_path)
        return directive

    prompt_text = corridor_payload.model_dump_json(indent=2)
    max_attempts = 2
    proposal: Optional[LLMProposal] = None

    for attempt in range(max_attempts):
        try:
            if call_llm_fn is not None:
                raw_response = call_llm_fn(prompt_text)
            else:
                raw_response = call_llm(
                    prompt=prompt_text,
                    provider=provider,
                    model_name=model_name,
                    api_key=effective_key,
                    timeout_s=8.0,
                )

            clean_json = _extract_json_block(raw_response)
            parsed_dict = json.loads(clean_json)

            proposal = LLMProposal(**parsed_dict)
            break
        except (ValidationError, json.JSONDecodeError, httpx.HTTPError, TimeoutError, Exception):
            if attempt < max_attempts - 1:
                continue
            directive = rules_fallback(corridor_payload, df=df, factors=factors_dict)
            if directives_log_path:
                append_directive_to_log(directive, directives_log_path)
            return directive

    if proposal is None:
        directive = rules_fallback(corridor_payload, df=df, factors=factors_dict)
        if directives_log_path:
            append_directive_to_log(directive, directives_log_path)
        return directive

    if proposal.actions and len(proposal.actions) > 0:
        actions = proposal.actions
    else:
        actions = [
            Action(
                type=proposal.type,
                lane=proposal.lane,
                seconds=proposal.seconds,
                target_class=proposal.target_class,
            )
        ]

    co2_saved = compute_action_savings(
        actions=actions,
        factors=factors_dict,
        df=df,
        payload=corridor_payload,
    )

    directive = Directive(
        intersection_id=corridor_payload.intersection_id,
        actions=actions,
        estimated_co2_saved_g=co2_saved,
        confidence=proposal.confidence,
        rationale=proposal.rationale,
        mode="llm",
    )

    if directives_log_path:
        append_directive_to_log(directive, directives_log_path)

    return directive


class LLMDispatcher:
    """Object-oriented dispatcher wrapper matching multi-agent caller patterns."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        provider: str = "gemini",
        model: str = "gemini-2.0-flash",
        directives_path: Optional[Union[str, Path]] = DEFAULT_DIRECTIVES_LOG,
    ):
        self.api_key = api_key or os.getenv("GEMINI_API_KEY", "")
        self.provider = provider
        self.model = model
        self.directives_path = Path(directives_path) if directives_path else None

    def _call_llm_raw(self, prompt: str) -> str:
        """Raw API invocation hook allowing seamless test mocking."""
        return call_llm(
            prompt=prompt,
            provider=self.provider,
            model_name=self.model,
            api_key=self.api_key,
            timeout_s=8.0,
        )

    def dispatch(
        self,
        payload: Union[CorridorPayload, Dict[str, Any]],
        df: Optional[Any] = None,
    ) -> Directive:
        """Dispatch corridor payload via LLM with automated rules fallback."""
        return dispatch(
            payload=payload,
            df=df,
            api_key=self.api_key,
            call_llm_fn=self._call_llm_raw if self.api_key else None,
            directives_log_path=self.directives_path,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="GenAI Municipal Signal Dispatcher")
    parser.add_argument("--payload", type=str, default=None, help="Path to JSON corridor payload")
    parser.add_argument("--offline", action="store_true", help="Force deterministic rules fallback mode")
    parser.add_argument("--log-path", type=str, default=str(DEFAULT_DIRECTIVES_LOG), help="Directives output JSONL log")
    args = parser.parse_args()

    if args.payload:
        with open(args.payload, "r", encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = {
            "intersection_id": "junction_01",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "window_s": 60.0,
            "co2_g_total": 140.0,
            "co2_g_per_min": 140.0,
            "idle_ratio": 0.45,
            "heavy_vehicle_density": 0.12,
            "n_counted_vehicles": 22,
            "n_stop_events": 4,
            "top_choke_zone": {"id": "z_r1_c2", "idle_vehicle_minutes": 5.5},
        }

    directive = dispatch(
        payload=data,
        offline=args.offline,
        directives_log_path=args.log_path,
    )
    print(directive.model_dump_json(indent=2))


if __name__ == "__main__":
    main()
