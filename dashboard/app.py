"""Eco-Kinetic Traffic Carbon Digital Twin — Streamlit Dashboard.

Edge CCTV perception, kinematic state analysis, corridor emissions, and municipal dispatch feed.
"""

from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Any, Dict, List, Optional, Tuple
import numpy as np
import pandas as pd
import pyarrow.parquet as pq
import streamlit as st
import yaml

# Ensure project root is in sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# Page configuration
st.set_page_config(
    page_title="Eco-Kinetic Traffic Carbon Twin",
    page_icon="🌿",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Custom sleek CSS
st.markdown(
    """
    <style>
    .metric-card {
        background-color: #1a1c24;
        border: 1px solid #2d313e;
        border-radius: 8px;
        padding: 16px;
        text-align: center;
    }
    .metric-value {
        font-size: 28px;
        font-weight: 700;
        color: #00d26a;
    }
    .metric-label {
        font-size: 13px;
        color: #9aa0a6;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    .badge-llm {
        background-color: #1e3a8a;
        color: #93c5fd;
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
    }
    .badge-rules {
        background-color: #854d0e;
        color: #fde047;
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
    }
    </style>
    """,
    unsafe_allow_html=True,
)


@st.cache_data(ttl=60)
def load_telemetry(artifacts_dir: Path) -> Tuple[pd.DataFrame, bool]:
    """Load telemetry.parquet with automatic fallback to fixture if missing."""
    target = artifacts_dir / "telemetry.parquet"
    is_fixture = False

    if not target.exists():
        fixture = REPO_ROOT / "tests" / "fixtures" / "telemetry_fixture.parquet"
        if fixture.exists():
            target = fixture
            is_fixture = True
        else:
            return pd.DataFrame(), False

    try:
        table = pq.read_table(target)
        df = table.to_pandas()
        return df, is_fixture
    except Exception:
        return pd.DataFrame(), False


@st.cache_data(ttl=60)
def load_emission_factors() -> Dict[str, Any]:
    cfg_path = REPO_ROOT / "config" / "emission_factors.yaml"
    if cfg_path.exists():
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                return yaml.safe_load(f) or {}
        except Exception:
            return {}
    return {}


@st.cache_data(ttl=60)
def load_json_artifact(file_path: Path) -> Optional[Dict[str, Any]]:
    if file_path.exists():
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None
    return None


def load_directives(artifacts_dir: Path) -> List[Dict[str, Any]]:
    """Read directives.jsonl using dispatcher Pydantic model if available."""
    directives_path = artifacts_dir / "directives.jsonl"
    if not directives_path.exists():
        return []

    # Attempt to import Pydantic model from dispatcher
    DirectiveModel = None
    try:
        from dispatcher.schema import Directive as DirectiveModel
    except Exception:
        try:
            from pydantic import BaseModel, Field

            class ActionModel(BaseModel):
                type: str
                lane: Optional[str] = None
                seconds: Optional[float] = None
                target_class: Optional[str] = None

            class DirectiveFallback(BaseModel):
                timestamp: str
                intersection_id: str
                actions: List[ActionModel]
                estimated_co2_saved_g: float
                confidence: float
                rationale: str
                mode: str

            DirectiveModel = DirectiveFallback
        except Exception:
            DirectiveModel = None

    items = []
    try:
        with open(directives_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    if DirectiveModel is not None:
                        obj = DirectiveModel(**data)
                        items.append(obj.model_dump() if hasattr(obj, "model_dump") else obj.dict())
                    else:
                        items.append(data)
                except Exception:
                    continue
    except Exception:
        return []

    return list(reversed(items))  # newest first


def compute_choke_points(df: pd.DataFrame, dt_s: float = 0.08) -> pd.DataFrame:
    """Compute local 4x4 spatial grid on cx_norm/cy_norm and idle minutes per cell."""
    if df.empty or "state" not in df.columns:
        return pd.DataFrame()

    idle_df = df[df["state"] == "IDLE"].copy()
    if idle_df.empty:
        return pd.DataFrame()

    cx = np.clip(idle_df["cx_norm"].values, 0.0, 0.9999)
    cy = np.clip(idle_df["cy_norm"].values, 0.0, 0.9999)

    grid_x = (cx * 4).astype(int)
    grid_y = (cy * 4).astype(int)
    idle_df["cell_id"] = [f"Z_{gx}_{gy}" for gx, gy in zip(grid_x, grid_y)]

    # Compute stats per cell
    rows = []
    for cell_id, grp in idle_df.groupby("cell_id"):
        idle_mins = (len(grp) * dt_s) / 60.0
        n_unique = grp["track_id"].nunique()
        heavy_count = grp[grp["cls"].isin(["bus", "truck"])]["track_id"].nunique()
        top_cls = grp["cls"].value_counts().index[0] if not grp.empty else "N/A"
        rows.append({
            "Zone ID": cell_id,
            "Idle Minutes": round(idle_mins, 2),
            "Unique Idlers": n_unique,
            "Heavy Idlers": heavy_count,
            "Top Idling Class": top_cls,
        })

    choke_df = pd.DataFrame(rows).sort_values(by="Idle Minutes", ascending=False).reset_index(drop=True)
    return choke_df


def count_stop_events(df: pd.DataFrame, min_frames: int = 30) -> int:
    """Count contiguous IDLE stop events >= min_frames."""
    if df.empty or "state" not in df.columns or "track_id" not in df.columns:
        return 0

    stops = 0
    for _, group in df.groupby("track_id", sort=False):
        states = group["state"].values
        is_idle = (states == "IDLE")
        if not np.any(is_idle):
            continue
        diff = np.diff(np.concatenate(([False], is_idle, [False])).astype(int))
        run_starts = np.where(diff == 1)[0]
        run_ends = np.where(diff == -1)[0]
        lengths = run_ends - run_starts
        stops += int(np.sum(lengths >= min_frames))
    return stops


# -------------------------------------------------------------
# MAIN APP
# -------------------------------------------------------------
def main() -> None:
    artifacts_dir = REPO_ROOT / "artifacts"

    # SECTION A: HEADER
    st.title("Eco-Kinetic Traffic Carbon Digital Twin")
    st.caption("Existing CCTV fleet → carbon intelligence; no new hardware, no video leaves the junction.")
    st.divider()

    # Load Data
    df, is_fixture = load_telemetry(artifacts_dir)
    em_factors = load_emission_factors()
    meta = load_json_artifact(artifacts_dir / "telemetry_meta.json")
    dt_s = float(meta.get("dt_s", 0.08)) if meta else 0.08

    if is_fixture:
        st.info("ℹ️ Telemetry not yet generated by live pipeline. Operating in offline fixture preview mode.")

    # SECTION B: METRIC CARDS
    # Safe computation of cards (never crashes)
    total_vehicles = df["track_id"].nunique() if not df.empty and "track_id" in df.columns else None

    # Cumulative CO2 placeholder (or real if computed)
    co2_display = "Pending twin — shows at integration"
    if not df.empty and "co2_cum_g" in df.columns:
        co2_display = f"{df['co2_cum_g'].max():.1f} g"
    else:
        # Check if twin can compute on the fly
        try:
            from twin.emission_engine import compute_track_emissions
            if not df.empty and em_factors:
                em_df = compute_track_emissions(df, em_factors, min_age=15)
                if not em_df.empty and "co2_cum_g" in em_df.columns:
                    co2_display = f"{em_df['co2_cum_g'].max():.1f} g"
        except Exception:
            pass

    # Idle share %
    if not df.empty and "state" in df.columns:
        gated = df[df["track_age_frames"] >= 15] if "track_age_frames" in df.columns else df
        idle_count = (gated["state"] == "IDLE").sum() if not gated.empty else 0
        total_gated = len(gated) if not gated.empty else 1
        idle_pct = (idle_count / max(1, total_gated)) * 100.0
        idle_share_str = f"{idle_pct:.1f}%"
    else:
        idle_share_str = "—"

    # Stop events
    if not df.empty:
        stop_events_val = count_stop_events(df, min_frames=int(round(3.0 / dt_s)))
        stop_events_str = str(stop_events_val)
    else:
        stop_events_str = "—"

    # Top Choke Zone
    choke_df = compute_choke_points(df, dt_s=dt_s)
    top_zone_str = str(choke_df.iloc[0]["Zone ID"]) if not choke_df.empty else "—"

    c1, c2, c3, c4, c5 = st.columns(5)
    with c1:
        st.metric("Vehicles Tracked", f"{total_vehicles}" if total_vehicles is not None else "—")
    with c2:
        st.metric("Cumulative CO2", co2_display)
    with c3:
        st.metric("Idle Share", idle_share_str)
    with c4:
        st.metric("Stop Events", stop_events_str)
    with c5:
        st.metric("Top Choke Zone", top_zone_str)

    st.write("")

    # SECTION C: SYNCED PLAYBACK & CHARTS
    col_video, col_charts = st.columns([1.1, 1.0])

    overlay_file = artifacts_dir / "overlay.mp4"
    with col_video:
        st.subheader("Junction Tracking Overlay")
        if overlay_file.exists():
            st.video(str(overlay_file))
        else:
            st.info("Overlay video `artifacts/overlay.mp4` not found. Showing telemetry charts below.")

    # Time Slider Control
    if not df.empty and "video_time_s" in df.columns:
        t_min = float(df["video_time_s"].min())
        t_max = float(df["video_time_s"].max())
        if t_max > t_min:
            t_curr = st.slider(
                "Telemetry Time Window Focus (60s range)",
                min_value=t_min,
                max_value=t_max,
                value=min(t_min + 30.0, t_max),
                step=max(0.5, round((t_max - t_min) / 100, 1)),
            )
            w_start = max(t_min, t_curr - 30.0)
            w_end = min(t_max, t_curr + 30.0)
            window_df = df[(df["video_time_s"] >= w_start) & (df["video_time_s"] <= w_end)]
        else:
            window_df = df
    else:
        window_df = df

    with col_charts:
        st.subheader("Kinematic Activity (60s Window)")
        if not window_df.empty and "state" in window_df.columns:
            # Kinematic state distribution in window
            state_counts = window_df["state"].value_counts()
            st.bar_chart(state_counts)
        else:
            st.write("No telemetry available for active window.")

    st.divider()

    # SECTION D: CHOKE-POINT TABLE & CORRIDOR PROFILE
    st.subheader("Corridor Choke Points (4x4 Spatial Grid)")
    if not choke_df.empty:
        st.dataframe(choke_df, use_container_width=True)
    else:
        st.info("No spatial idle events detected in telemetry.")

    st.divider()

    # SECTION E: DIRECTIVE FEED
    st.subheader("Municipal Dispatcher Directives")
    directives = load_directives(artifacts_dir)
    if directives:
        for d in directives:
            with st.container():
                cols = st.columns([0.2, 0.45, 0.2, 0.15])
                mode = d.get("mode", "rules_fallback")
                badge_class = "badge-llm" if mode == "llm" else "badge-rules"
                with cols[0]:
                    st.markdown(f"<span class='{badge_class}'>{mode.upper()}</span>", unsafe_allow_html=True)
                    st.caption(d.get("timestamp", "N/A"))
                with cols[1]:
                    st.write(f"**Rationale**: {d.get('rationale', 'No rationale provided')}")
                    actions = d.get("actions", [])
                    action_texts = [f"{a.get('type')}: {a.get('seconds', '')}s on lane {a.get('lane', '')}" for a in actions]
                    st.caption(f"Actions: {'; '.join(action_texts) if action_texts else 'None'}")
                with cols[2]:
                    st.metric("Est. CO2 Saved", f"{d.get('estimated_co2_saved_g', 0.0):.1f} g")
                with cols[3]:
                    st.metric("Confidence", f"{d.get('confidence', 0.0):.2f}")
                st.divider()
    else:
        st.info("No directives yet — waiting for dispatcher trigger.")

    # SECTION F: WHAT-IF SCENARIOS (LAZY IMPORT)
    st.subheader("What-If Counterfactual Policy Simulation")
    try:
        from twin.scenarios import apply_scenario
        scenario_available = True
    except ImportError:
        scenario_available = False

    if not scenario_available:
        st.info("Scenario engine pending (track C)")
    else:
        with st.expander("Configure Policy Intervention", expanded=True):
            sc_col1, sc_col2 = st.columns([1, 1])
            with sc_col1:
                st.write("**Fleet Electrification (EV Share)**")
                ev_car = st.slider("Car EV %", 0, 100, 20) / 100.0
                ev_moto = st.slider("Motorcycle EV %", 0, 100, 30) / 100.0
                ev_auto = st.slider("Auto-Rickshaw EV %", 0, 100, 25) / 100.0
                ev_bus = st.slider("Bus EV %", 0, 100, 50) / 100.0
                ev_truck = st.slider("Truck EV %", 0, 100, 10) / 100.0
                ev_dict = {
                    "car": ev_car,
                    "motorcycle": ev_moto,
                    "auto_rickshaw": ev_auto,
                    "bus": ev_bus,
                    "truck": ev_truck,
                }
            with sc_col2:
                st.write("**Signal & Corridor Policy**")
                green_ext = st.slider("Adaptive Green Extension (seconds)", 0, 15, 6)
                heavy_restr = st.toggle("Heavy Vehicle Restriction (10s priority wave for Bus/Truck)", value=True)

            if not df.empty and em_factors:
                scenario_res = apply_scenario(
                    df=df,
                    factors=em_factors,
                    ev_share=ev_dict,
                    green_extension_s=green_ext,
                    heavy_restriction=heavy_restr,
                    min_age=15,
                    dt_s=dt_s,
                )

                base_co2 = scenario_res["baseline_co2_g"]
                scen_co2 = scenario_res["scenario_co2_g"]
                avoid_co2 = scenario_res["avoided_g"]
                pct_saved = (avoid_co2 / max(0.001, base_co2)) * 100.0

                m1, m2, m3 = st.columns(3)
                m1.metric("Baseline CO2", f"{base_co2:.1f} g")
                m2.metric("Scenario CO2", f"{scen_co2:.1f} g", delta=f"-{avoid_co2:.1f} g", delta_color="normal")
                m3.metric("Carbon Abatement", f"{pct_saved:.1f}%")

                st.write("**Per-Class Savings**")
                breakdown = scenario_res.get("per_class_breakdown", {})
                if breakdown:
                    b_df = pd.DataFrame(breakdown).T
                    b_df.rename(columns={
                        "baseline_co2_g": "Baseline CO2 (g)",
                        "scenario_co2_g": "Scenario CO2 (g)",
                        "avoided_g": "Avoided CO2 (g)",
                        "ev_share": "EV Share",
                    }, inplace=True)
                    st.dataframe(b_df, use_container_width=True)

    # SECTION G: SIDEBAR METHODOLOGY EXPANDER
    with st.sidebar:
        st.subheader("System Configuration")
        if meta:
            st.write(f"**FPS**: {meta.get('video_fps', 'N/A')}")
            st.write(f"**Frame Skip**: {meta.get('frame_skip', 'N/A')}")
            st.write(f"**Resolution**: {meta.get('img_w', 'N/A')}x{meta.get('img_h', 'N/A')}")
            st.write(f"**Step Size ($dt_s$)**: {meta.get('dt_s', 'N/A'):.3f}s")

        with st.expander("Methodology & Emission Factors", expanded=False):
            st.caption("Emissions are indicative mode-bin estimates, not tailpipe measurements.")
            if em_factors and "classes" in em_factors:
                ef_rows = []
                for c_name, c_data in em_factors["classes"].items():
                    ef_rows.append({
                        "Class": c_name,
                        "Idle (g/min)": c_data.get("idle_g_per_min", "N/A"),
                        "Cruise (g/km)": c_data.get("cruise_g_per_km", "N/A"),
                        "Accel Mult": c_data.get("accel_multiplier", "N/A"),
                        "Length (m)": c_data.get("mean_length_m", "N/A"),
                        "Source": c_data.get("source", "TODO"),
                        "Year": c_data.get("year", "TODO"),
                    })
                st.dataframe(pd.DataFrame(ef_rows), use_container_width=True)
            else:
                st.write("Emission factors config not found.")

            st.write("**Core Assumptions**:")
            st.markdown(
                r"""
                - Vehicle speeds estimated via length-calibrated bounding box proxy.
                - Idle emissions accumulate during zero-motion phases ($\ge 3$s threshold).
                - Stop events gate tracks at $\ge 15$ frames to avoid tracking churn bias.
                """
            )


if __name__ == "__main__":
    main()
