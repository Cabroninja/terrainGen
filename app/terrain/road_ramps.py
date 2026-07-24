from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.core.models import RoadRamp


@dataclass(slots=True)
class RoadRampResult:
    height: np.ndarray
    road_mask: np.ndarray
    issues: list[dict]
    summaries: list[dict]


def _smoothstep(value: np.ndarray) -> np.ndarray:
    t = np.clip(value, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _smootherstep(value: np.ndarray) -> np.ndarray:
    t = np.clip(value, 0.0, 1.0)
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def _sample_height(height: np.ndarray, x: float, z: float) -> float:
    zi = int(np.clip(round(z), 0, height.shape[0] - 1))
    xi = int(np.clip(round(x), 0, height.shape[1] - 1))
    return float(height[zi, xi])


def _sample_height_grid(height: np.ndarray, x: np.ndarray, z: np.ndarray) -> np.ndarray:
    zi = np.clip(np.rint(z).astype(np.int32), 0, height.shape[0] - 1)
    xi = np.clip(np.rint(x).astype(np.int32), 0, height.shape[1] - 1)
    return height[zi, xi].astype(np.float32)


def _ramp_profile(
    progress: np.ndarray,
    total_length: float,
    start_height: float,
    end_height: float,
    start_landing: float,
    end_landing: float,
) -> np.ndarray:
    run_start = min(start_landing, total_length)
    run_end = max(run_start, total_length - end_landing)
    run_length = max(1e-6, run_end - run_start)
    t = np.clip((progress - run_start) / run_length, 0.0, 1.0)
    profile = start_height + (end_height - start_height) * t
    profile = np.where(progress <= run_start, start_height, profile)
    profile = np.where(progress >= run_end, end_height, profile)
    return profile.astype(np.float32)


def _lateral_influence(
    *,
    distance: np.ndarray,
    half_width: float,
    target: np.ndarray,
    terrain: np.ndarray,
    center_reference: np.ndarray,
    ramp: RoadRamp,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return influence, affected mask and the effective lateral width.

    With smoothing disabled, the legacy fixed-width shoulder is preserved.
    With smoothing enabled, each cross-section receives a dynamic side width
    based on the vertical difference and the requested 1:X side slope. The
    width is strictly capped, so no cell outside the explicit corridor can be
    changed.
    """

    center = distance <= half_width + 1e-6
    lateral_distance = np.maximum(distance - half_width, 0.0).astype(np.float32)

    if not ramp.smooth_sides:
        width = np.full(distance.shape, float(ramp.shoulder_width), dtype=np.float32)
        if ramp.shoulder_width > 0:
            phase = lateral_distance / float(ramp.shoulder_width)
            influence = 1.0 - _smoothstep(phase)
            affected = center | (lateral_distance <= float(ramp.shoulder_width) + 1e-6)
        else:
            influence = center.astype(np.float32)
            affected = center
        influence = np.where(affected, np.clip(influence, 0.0, 1.0), 0.0)
        influence[center] = 1.0
        return influence.astype(np.float32), affected, width

    # "Seguir terreno" uses the local terrain delta, adapting the side reach
    # independently to hollows and high spots. Disabled uses the center-line
    # ground reference, producing a cleaner and more symmetrical engineered cut.
    local_delta = np.abs(target - terrain)
    center_delta = np.abs(target - center_reference)
    width_basis = local_delta if ramp.follow_terrain else center_delta

    minimum_width = float(ramp.shoulder_width)
    maximum_width = float(max(ramp.max_side_width, ramp.shoulder_width))
    dynamic_width = width_basis * float(ramp.side_slope_ratio)
    effective_width = np.clip(np.maximum(dynamic_width, minimum_width), 0.0, maximum_width).astype(np.float32)

    safe_width = np.maximum(effective_width, 1e-6)
    normalized = np.clip(lateral_distance / safe_width, 0.0, 1.0)
    roundness = float(ramp.side_roundness) / 100.0
    phase = normalized * (1.0 - roundness) + _smootherstep(normalized) * roundness
    influence = 1.0 - phase
    affected = center | ((effective_width > 1e-6) & (lateral_distance <= effective_width + 1e-6))
    influence = np.where(affected, np.clip(influence, 0.0, 1.0), 0.0)
    influence[center] = 1.0
    return influence.astype(np.float32), affected, effective_width


def apply_road_ramps(source_height: np.ndarray, painted_roads: np.ndarray, ramps: list[RoadRamp]) -> RoadRampResult:
    """Apply explicit, bounded road ramps without changing unrelated terrain.

    The center corridor receives the exact longitudinal ramp height. Its sides
    either use the original fixed-width transition or an optional adaptive,
    rounded embankment. Normal painted roads are copied unchanged and never
    modify height.
    """

    height = source_height.astype(np.float32, copy=True)
    road_mask = painted_roads.astype(np.uint8, copy=True)
    issues: list[dict] = []
    summaries: list[dict] = []
    map_length, map_width = height.shape

    for ramp in ramps:
        points = np.asarray([(point.x, point.z) for point in ramp.points], dtype=np.float32)
        vectors = points[1:] - points[:-1]
        segment_lengths = np.sqrt(np.sum(vectors * vectors, axis=1))
        total_length = float(segment_lengths.sum())
        if total_length <= 1e-6:
            issues.append({
                "severity": "error",
                "code": "road_ramp_zero_length",
                "message": f"La rampa «{ramp.label or ramp.id}» no tiene longitud útil.",
            })
            continue

        start_height = _sample_height(source_height, *points[0])
        end_height = _sample_height(source_height, *points[-1])
        delta_height = abs(end_height - start_height)
        available_run = max(0.0, total_length - ramp.start_landing - ramp.end_landing)
        required_run = delta_height * ramp.slope_ratio
        actual_ratio = available_run / delta_height if delta_height > 1e-6 else float("inf")
        valid = available_run + 1e-6 >= required_run
        if not valid:
            issues.append({
                "severity": "error",
                "code": "road_ramp_too_short",
                "message": (
                    f"La rampa «{ramp.label or ramp.id}» mide {total_length:.1f} bloques, "
                    f"pero necesita al menos {required_run + ramp.start_landing + ramp.end_landing:.1f} "
                    f"para mantener una pendiente 1:{ramp.slope_ratio:g}."
                ),
            })

        half_width = ramp.width / 2.0
        lateral_limit = float(max(ramp.max_side_width, ramp.shoulder_width) if ramp.smooth_sides else ramp.shoulder_width)
        outer_radius = half_width + lateral_limit
        x0 = max(0, int(np.floor(points[:, 0].min() - outer_radius - 1)))
        x1 = min(map_width - 1, int(np.ceil(points[:, 0].max() + outer_radius + 1)))
        z0 = max(0, int(np.floor(points[:, 1].min() - outer_radius - 1)))
        z1 = min(map_length - 1, int(np.ceil(points[:, 1].max() + outer_radius + 1)))
        zz, xx = np.mgrid[z0:z1 + 1, x0:x1 + 1]
        gx = xx.astype(np.float32)
        gz = zz.astype(np.float32)
        best_distance_sq = np.full(gx.shape, np.inf, dtype=np.float32)
        best_progress = np.zeros(gx.shape, dtype=np.float32)
        best_nearest_x = np.zeros(gx.shape, dtype=np.float32)
        best_nearest_z = np.zeros(gx.shape, dtype=np.float32)
        cumulative = 0.0

        for (ax, az), (vx, vz), segment_length in zip(points[:-1], vectors, segment_lengths, strict=True):
            if segment_length <= 1e-6:
                continue
            denominator = float(segment_length * segment_length)
            t = np.clip(((gx - ax) * vx + (gz - az) * vz) / denominator, 0.0, 1.0)
            nearest_x = ax + t * vx
            nearest_z = az + t * vz
            distance_sq = (gx - nearest_x) ** 2 + (gz - nearest_z) ** 2
            closer = distance_sq < best_distance_sq
            best_distance_sq = np.where(closer, distance_sq, best_distance_sq)
            best_progress = np.where(closer, cumulative + t * segment_length, best_progress)
            best_nearest_x = np.where(closer, nearest_x, best_nearest_x)
            best_nearest_z = np.where(closer, nearest_z, best_nearest_z)
            cumulative += float(segment_length)

        distance = np.sqrt(best_distance_sq)
        target = _ramp_profile(
            best_progress,
            total_length,
            start_height,
            end_height,
            float(ramp.start_landing),
            float(ramp.end_landing),
        )
        target_slice = height[z0:z1 + 1, x0:x1 + 1]
        terrain_before = target_slice.copy()
        center_reference = _sample_height_grid(source_height, best_nearest_x, best_nearest_z)
        influence, affected, effective_width = _lateral_influence(
            distance=distance,
            half_width=half_width,
            target=target,
            terrain=terrain_before,
            center_reference=center_reference,
            ramp=ramp,
        )
        center = distance <= half_width + 1e-6
        if not np.any(affected):
            continue

        # Explicit and bounded: outside `affected`, the existing height remains
        # byte-for-byte unchanged. Only the central road and configured sides act.
        target_slice[affected] = (
            terrain_before[affected] * (1.0 - influence[affected])
            + target[affected] * influence[affected]
        )

        road_slice = road_mask[z0:z1 + 1, x0:x1 + 1]
        road_value = 1 if ramp.road_type == "primary" else 2
        if road_value == 1:
            road_slice[center] = 1
        else:
            road_slice[center & (road_slice == 0)] = 2

        summaries.append({
            "id": ramp.id,
            "label": ramp.label,
            "length": round(total_length, 3),
            "start_height": round(start_height, 3),
            "end_height": round(end_height, 3),
            "height_difference": round(delta_height, 3),
            "minimum_ratio": ramp.slope_ratio,
            "actual_ratio": None if not np.isfinite(actual_ratio) else round(actual_ratio, 3),
            "valid": valid,
            "width": ramp.width,
            "shoulder_width": ramp.shoulder_width,
            "smooth_sides": ramp.smooth_sides,
            "side_slope_ratio": ramp.side_slope_ratio,
            "max_side_width": ramp.max_side_width,
            "side_roundness": ramp.side_roundness,
            "follow_terrain": ramp.follow_terrain,
            "effective_side_width_max": round(float(effective_width[affected].max()), 3) if np.any(affected) else 0.0,
        })

    return RoadRampResult(height=height, road_mask=road_mask, issues=issues, summaries=summaries)
