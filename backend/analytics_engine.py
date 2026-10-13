from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Dict, List, Optional


def calculate_growth_velocities(scans: List[dict]) -> Dict[str, float]:
    """Calculate daily growth velocities (cm/day) across active greenhouse blocks.

    Returns a mapping of block_id -> velocity_cm_per_day.
    Uses linear regression on height-versus-time for deterministic results.
    """
    block_data: Dict[str, List[dict]] = defaultdict(list)

    for scan in scans:
        block_id = scan.get("block_id")
        height = scan.get("avg_stem_height_cm")
        scanned_at = scan.get("scanned_at")

        if not block_id or height is None or not scanned_at:
            continue

        try:
            t = datetime.fromisoformat(scanned_at.replace("Z", "+00:00"))
        except Exception:
            continue

        block_data[block_id].append({"height": float(height), "timestamp": t})

    velocities: Dict[str, float] = {}

    for block_id, points in block_data.items():
        if len(points) < 2:
            velocities[block_id] = 0.0
            continue

        # Sort by timestamp ascending
        points.sort(key=lambda p: p["timestamp"])
        n = len(points)
        heights = [p["height"] for p in points]
        xs = list(range(n))  # 0, 1, 2, ..., n-1 representing equal time steps

        # Linear regression slope: y = mx + b
        # m = (n*Σ(xy) - Σx*Σy) / (n*Σ(x²) - (Σx)²)
        sum_x = sum(xs)
        sum_y = sum(heights)
        sum_xy = sum(x * y for x, y in zip(xs, heights))
        sum_x2 = sum(x * x for x in xs)

        denom = n * sum_x2 - sum_x ** 2
        if denom == 0:
            velocities[block_id] = 0.0
        else:
            velocity = (n * sum_xy - sum_x * sum_y) / denom
            velocities[block_id] = round(float(velocity), 2)

    return velocities


def compute_export_projections(
    velocities: Dict[str, float],
    blocks: List[dict],
    days_ahead: int = 30,
) -> Dict[str, dict]:
    """Compute long‑range export volume projections and confidence intervals.

    For each block, projects stem volume over the given horizon based on
    daily growth velocity, with confidence decay over longer horizons.
    """
    projections: Dict[str, dict] = {}

    for block in blocks:
        block_id = block.get("id")
        block_name = block.get("block_name", "Unknown")
        velocity = velocities.get(block_id, 0.0)
        target_days = block.get("target_harvest_days", 60)

        # Daily growth used for projection (enforce minimum realistic threshold)
        daily_velocity = max(velocity, 0.3)

        # Linear projection: stems per day * days_ahead
        raw_projection = int(daily_velocity * days_ahead)

        # Confidence decay: the further out we project, the less certain
        # Decay factor: 1.0 at 0 days, ~0.5 at 60 days
        decay_factor = max(0.4, 1.0 - (days_ahead / 60.0))

        export_volume = max(100, int(raw_projection * decay_factor))

        projections[block_name] = {
            "projected_export_volume_stems": export_volume,
            "velocity_cm_per_day": velocity,
            "days_projected": days_ahead,
            "confidence": round(decay_factor, 2),
            "target_harvest_days": target_days,
        }

    return projections


def check_dispatch_readiness(
    projections: Dict[str, dict],
    window_days: int = 7,
) -> List[dict]:
    """Identify cold‑chain dispatch readiness windows for upcoming retail deadlines.

    A block is considered "ready" when its daily velocity is sufficient
    (≥ 1.0 cm/day) and projected volume exceeds a threshold, with acceptable
    confidence for cold‑chain scheduling.
    """
    ready_windows: List[dict] = []

    for block_name, proj in projections.items():
        velocity = proj.get("velocity_cm_per_day", 0.0)
        confidence = proj.get("confidence", 0.0)
        export_volume = proj.get("projected_export_volume_stems", 0)

        # Ready if velocity meets minimum dispatch threshold and confidence is adequate
        if velocity >= 1.0 and confidence >= 0.5 and export_volume >= 500:
            ready_windows.append(
                {
                    "block": block_name,
                    "dispatch_window_start": f"within {window_days} days",
                    "export_volume": export_volume,
                    "readiness_score": round(confidence, 2),
                    "velocity_cm_per_day": velocity,
                }
            )

    # Sort by readiness score (highest first)
    ready_windows.sort(key=lambda w: w["readiness_score"], reverse=True)
    return ready_windows


def compute_block_velocity_average(
    velocities: Dict[str, float],
) -> Optional[float]:
    """Compute the average growth velocity across all active blocks.

    Useful for the dashboard "Average Growth Velocity" summary card.
    """
    if not velocities:
        return None
    values = list(velocities.values())
    non_zero = [v for v in values if v > 0]
    if not non_zero:
        return round(sum(values) / len(values), 2)
    return round(sum(non_zero) / len(non_zero), 2)


def forecast_harvest_dates(
    velocities: Dict[str, float],
    blocks: List[dict],
    target_harvest_days: int = 60,
) -> Dict[str, dict]:
    """Forecast projected harvest dates based on current growth velocity.

    For each block, estimates how many days remain until the target harvest
    diameter/height is reached, given the current daily velocity.
    """
    forecasts: Dict[str, dict] = {}

    for block in blocks:
        block_id = block.get("id")
        block_name = block.get("block_name", "Unknown")
        target = block.get("target_harvest_days", target_harvest_days)
        velocity = velocities.get(block_id, 0.0)

        if velocity <= 0:
            forecasts[block_name] = {
                "projected_harvest_date": None,
                "days_remaining": None,
                "growth_status": "stalled",
            }
            continue

        # Days to reach target at current velocity
        days_remaining = round(target / max(velocity, 0.1), 1)

        # Projected harvest date (UTC)
        projected_date = datetime.utcnow() + timedelta(days=days_remaining)

        forecasts[block_name] = {
            "projected_harvest_date": projected_date.strftime("%Y-%m-%d"),
            "days_remaining": days_remaining,
            "growth_status": "on_track" if days_remaining <= target else "slow growth",
        }

    return forecasts