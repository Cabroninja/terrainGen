from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.ndimage import distance_transform_edt

from app.core.models import ProjectConfig, WaterCourse


@dataclass(slots=True)
class WaterSystemResult:
    height: np.ndarray
    water_mask: np.ndarray
    water_surface: np.ndarray
    exit_mask: np.ndarray
    shore_mask: np.ndarray
    ford_mask: np.ndarray
    road_cut_mask: np.ndarray
    issues: list[dict]
    summaries: list[dict]


def _smoothstep(value: np.ndarray) -> np.ndarray:
    value = np.clip(value, 0.0, 1.0)
    return value * value * (3.0 - 2.0 * value)


def _smootherstep(value: np.ndarray) -> np.ndarray:
    value = np.clip(value, 0.0, 1.0)
    return value * value * value * (value * (value * 6.0 - 15.0) + 10.0)


def _shore_influence(normalized: np.ndarray, profile: str) -> np.ndarray:
    normalized = np.clip(normalized, 0.0, 1.0)
    if profile == "compact":
        phase = normalized
    elif profile == "smooth":
        phase = _smootherstep(normalized)
    else:
        phase = _smoothstep(normalized)
    return (1.0 - phase).astype(np.float32)


def _sample_height(height: np.ndarray, x: float, z: float) -> float:
    xi = int(np.clip(round(x), 0, height.shape[1] - 1))
    zi = int(np.clip(round(z), 0, height.shape[0] - 1))
    return float(height[zi, xi])


def _moving_average(values: np.ndarray, amount: int) -> np.ndarray:
    if values.size < 3 or amount <= 0:
        return values.astype(np.float32, copy=True)
    passes = max(1, int(round(amount / 25)))
    result = values.astype(np.float32, copy=True)
    first = float(result[0])
    last = float(result[-1])
    for _ in range(passes):
        padded = np.pad(result, (1, 1), mode="edge")
        result = (padded[:-2] + padded[1:-1] * 2.0 + padded[2:]) / 4.0
        result[0] = first
        result[-1] = last
    return result


def _nearest_boundary_point(point: np.ndarray, direction: np.ndarray, width: int, length: int) -> np.ndarray:
    x, z = float(point[0]), float(point[1])
    vx, vz = float(direction[0]), float(direction[1])
    candidates: list[tuple[float, float, float]] = []
    if abs(vx) > 1e-6:
        for edge_x in (0.0, float(width - 1)):
            t = (edge_x - x) / vx
            edge_z = z + t * vz
            if t > 0 and -1e-6 <= edge_z <= length - 1 + 1e-6:
                candidates.append((t, edge_x, float(np.clip(edge_z, 0, length - 1))))
    if abs(vz) > 1e-6:
        for edge_z in (0.0, float(length - 1)):
            t = (edge_z - z) / vz
            edge_x = x + t * vx
            if t > 0 and -1e-6 <= edge_x <= width - 1 + 1e-6:
                candidates.append((t, float(np.clip(edge_x, 0, width - 1)), edge_z))
    if candidates:
        _, bx, bz = min(candidates, key=lambda item: item[0])
        return np.asarray([bx, bz], dtype=np.float32)

    edge_candidates = [
        np.asarray([0.0, z], dtype=np.float32),
        np.asarray([float(width - 1), z], dtype=np.float32),
        np.asarray([x, 0.0], dtype=np.float32),
        np.asarray([x, float(length - 1)], dtype=np.float32),
    ]
    return min(edge_candidates, key=lambda candidate: float(np.sum((candidate - point) ** 2)))


def _prepare_course_points(
    course: WaterCourse,
    profile_height: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, float, bool, list[dict]]:
    issues: list[dict] = []
    points = np.asarray([(point.x, point.z) for point in course.points], dtype=np.float32)
    if points.shape[0] < 2:
        return points, np.zeros(0, dtype=np.float32), np.zeros(0, dtype=np.float32), 0.0, False, issues

    vectors = points[1:] - points[:-1]
    segment_lengths = np.sqrt(np.sum(vectors * vectors, axis=1))
    useful = np.concatenate(([True], segment_lengths > 0.25))
    points = points[useful]
    if points.shape[0] < 2:
        return points, np.zeros(0, dtype=np.float32), np.zeros(0, dtype=np.float32), 0.0, False, issues

    sampled = np.asarray([_sample_height(profile_height, x, z) for x, z in points], dtype=np.float32)
    reversed_flow = False
    if not course.exit_enabled and sampled[0] < sampled[-1]:
        points = points[::-1].copy()
        sampled = sampled[::-1].copy()
        reversed_flow = True

    user_points_count = points.shape[0]
    user_vectors = points[1:] - points[:-1]
    user_lengths = np.sqrt(np.sum(user_vectors * user_vectors, axis=1))
    user_total_length = float(user_lengths.sum())

    if course.exit_enabled:
        direction = points[-1] - points[-2]
        if float(np.linalg.norm(direction)) <= 1e-6:
            direction = np.asarray([1.0, 0.0], dtype=np.float32)
        boundary = _nearest_boundary_point(points[-1], direction, profile_height.shape[1], profile_height.shape[0])
        if float(np.linalg.norm(boundary - points[-1])) > 0.5:
            points = np.vstack([points, boundary])
            sampled = np.append(sampled, sampled[-1])
        if sampled[0] + 0.5 < sampled[min(user_points_count - 1, sampled.size - 1)]:
            issues.append({
                "severity": "warning",
                "code": "water_exit_uphill",
                "message": f"El río «{course.label or course.id}» llega a su salida desde una cota más baja; el cauce se excavará para conservar flujo descendente.",
            })

    vectors = points[1:] - points[:-1]
    segment_lengths = np.sqrt(np.sum(vectors * vectors, axis=1))
    cumulative = np.concatenate(([0.0], np.cumsum(segment_lengths))).astype(np.float32)
    smoothed = _moving_average(sampled, course.smoothing)

    # El agua se interpreta desde el extremo alto hacia el bajo. El perfil nunca
    # sube en la dirección del flujo, pero sí puede seguir rampas y mesetas cuando
    # el usuario dibuja desde la cota alta (o el editor invierte el trazo).
    surface_profile = np.minimum.accumulate(smoothed).astype(np.float32)
    if course.exit_enabled and surface_profile.size > user_points_count:
        surface_profile[user_points_count:] = surface_profile[user_points_count - 1]

    return points, cumulative, surface_profile, user_total_length, reversed_flow, issues


def _polyline_fields(points: np.ndarray, cumulative: np.ndarray, x: np.ndarray, z: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    best_distance_sq = np.full(x.shape, np.inf, dtype=np.float32)
    best_progress = np.zeros(x.shape, dtype=np.float32)
    for index, ((ax, az), (bx, bz)) in enumerate(zip(points[:-1], points[1:], strict=True)):
        vx = float(bx - ax)
        vz = float(bz - az)
        denominator = vx * vx + vz * vz
        if denominator <= 1e-8:
            continue
        t = np.clip(((x - ax) * vx + (z - az) * vz) / denominator, 0.0, 1.0)
        nearest_x = ax + t * vx
        nearest_z = az + t * vz
        distance_sq = (x - nearest_x) ** 2 + (z - nearest_z) ** 2
        closer = distance_sq < best_distance_sq
        best_distance_sq = np.where(closer, distance_sq, best_distance_sq)
        segment_length = float(cumulative[index + 1] - cumulative[index])
        best_progress = np.where(closer, cumulative[index] + t * segment_length, best_progress)
    return np.sqrt(best_distance_sq), best_progress


def _apply_mass_water(
    height: np.ndarray,
    water_mask: np.ndarray,
    water_surface: np.ndarray,
    painted_water: np.ndarray,
    roads: np.ndarray,
    config: ProjectConfig,
    shore_mask: np.ndarray,
    ford_mask: np.ndarray,
    road_cut_mask: np.ndarray,
) -> dict:
    painted = painted_water.astype(bool, copy=False)
    if not np.any(painted):
        return {"cells": 0, "road_cells": 0}

    protected = (roads > 0) if config.water_road_policy == "protect" else np.zeros_like(painted)
    active = painted & ~protected
    floor_y = float(config.sea_level - config.water_depth)
    original = height.copy()
    normal_channel = active & ~((roads > 0) & (config.water_road_policy == "ford"))
    height[normal_channel] = np.minimum(height[normal_channel], floor_y)

    ford = active & (roads > 0) & (config.water_road_policy == "ford")
    cut = active & (roads > 0) & (config.water_road_policy == "cut")
    ford_mask[ford] = 1
    road_cut_mask[cut] = 1
    surface_values = np.full(height.shape, config.sea_level, dtype=np.int16)
    if np.any(ford):
        surface_values[ford] = np.rint(original[ford] + 1.0).astype(np.int16)

    water_mask[active] = 1
    water_surface[active] = np.maximum(water_surface[active], surface_values[active])

    if config.shore_width > 0 and np.any(active):
        distance = distance_transform_edt(~active)
        shore = (distance > 0) & (distance <= float(config.shore_width)) & ~protected
        if np.any(shore):
            influence = _shore_influence(distance / float(config.shore_width), config.water_shore_profile)
            target = np.minimum(original, float(config.sea_level - 1))
            shore_mask[shore] = 1
            height[shore] = np.minimum(
                height[shore],
                original[shore] * (1.0 - influence[shore]) + target[shore] * influence[shore],
            )

    return {"cells": int(active.sum()), "road_cells": int((active & (roads > 0)).sum())}


def apply_water_system(
    source_height: np.ndarray,
    profile_height: np.ndarray,
    painted_water: np.ndarray,
    roads: np.ndarray,
    courses: list[WaterCourse],
    config: ProjectConfig,
) -> WaterSystemResult:
    """Compile painted lakes and freehand river objects with per-cell levels.

    Painted water remains a simple mass at the configured global level. Rivers
    are explicit freehand objects: their centerline follows the terrain/ramp
    profile from high to low, their channel and shore are strictly bounded, and
    an optional outlet extends the last stroke toward the map boundary so the
    water can disappear through the mountain ring.
    """

    height = source_height.astype(np.float32, copy=True)
    water_mask = np.zeros(height.shape, dtype=np.uint8)
    water_surface = np.full(height.shape, -1, dtype=np.int16)
    exit_mask = np.zeros(height.shape, dtype=np.uint8)
    shore_mask = np.zeros(height.shape, dtype=np.uint8)
    ford_mask = np.zeros(height.shape, dtype=np.uint8)
    road_cut_mask = np.zeros(height.shape, dtype=np.uint8)
    issues: list[dict] = []
    summaries: list[dict] = []

    mass_summary = _apply_mass_water(height, water_mask, water_surface, painted_water, roads, config, shore_mask, ford_mask, road_cut_mask)

    map_length, map_width = height.shape
    for course in courses:
        points, cumulative, surface_profile, user_total_length, reversed_flow, course_issues = _prepare_course_points(course, profile_height)
        issues.extend(course_issues)
        if points.shape[0] < 2 or cumulative.size < 2 or float(cumulative[-1]) <= 1e-6:
            issues.append({
                "severity": "error",
                "code": "water_course_zero_length",
                "message": f"El río «{course.label or course.id}» no tiene un recorrido útil.",
            })
            continue

        half_width = float(course.width) / 2.0
        outer_radius = half_width + float(course.shore_width)
        x0 = max(0, int(np.floor(points[:, 0].min() - outer_radius - 1)))
        x1 = min(map_width - 1, int(np.ceil(points[:, 0].max() + outer_radius + 1)))
        z0 = max(0, int(np.floor(points[:, 1].min() - outer_radius - 1)))
        z1 = min(map_length - 1, int(np.ceil(points[:, 1].max() + outer_radius + 1)))
        zz, xx = np.mgrid[z0:z1 + 1, x0:x1 + 1]
        gx = xx.astype(np.float32)
        gz = zz.astype(np.float32)
        distance, progress = _polyline_fields(points, cumulative, gx, gz)
        surface = np.interp(progress, cumulative, surface_profile).astype(np.float32)
        center = distance <= half_width + 1e-6
        road_slice = roads[z0:z1 + 1, x0:x1 + 1] > 0
        protected = road_slice if course.road_policy == "protect" else np.zeros_like(center)
        active_center = center & ~protected

        terrain_slice = height[z0:z1 + 1, x0:x1 + 1]
        before = terrain_slice.copy()
        floor = surface - float(course.depth)
        ford = active_center & road_slice & (course.road_policy == "ford")
        cut = active_center & road_slice & (course.road_policy == "cut")
        normal = active_center & ~ford
        terrain_slice[normal] = np.minimum(terrain_slice[normal], floor[normal])

        surface_i = np.rint(surface).astype(np.int16)
        if np.any(ford):
            surface_i[ford] = np.rint(before[ford] + 1.0).astype(np.int16)

        local_ford = ford_mask[z0:z1 + 1, x0:x1 + 1]
        local_cut = road_cut_mask[z0:z1 + 1, x0:x1 + 1]
        local_ford[ford] = 1
        local_cut[cut] = 1

        local_mask = water_mask[z0:z1 + 1, x0:x1 + 1]
        local_surface = water_surface[z0:z1 + 1, x0:x1 + 1]
        local_mask[active_center] = 1
        local_surface[active_center] = np.maximum(local_surface[active_center], surface_i[active_center])

        if course.shore_width > 0:
            lateral = np.maximum(distance - half_width, 0.0)
            shore = (
                (lateral > 0)
                & (lateral <= float(course.shore_width) + 1e-6)
                & ~protected
            )
            if np.any(shore):
                influence = _shore_influence(lateral / float(course.shore_width), course.shore_profile)
                bank_target = np.minimum(before, surface - 1.0)
                local_shore = shore_mask[z0:z1 + 1, x0:x1 + 1]
                local_shore[shore] = 1
                terrain_slice[shore] = np.minimum(
                    terrain_slice[shore],
                    before[shore] * (1.0 - influence[shore]) + bank_target[shore] * influence[shore],
                )

        if course.exit_enabled:
            local_exit = exit_mask[z0:z1 + 1, x0:x1 + 1]
            local_exit[active_center & (progress >= user_total_length - 1e-3)] = 1

        road_cells = int((active_center & road_slice).sum())
        summaries.append({
            "id": course.id,
            "label": course.label,
            "length": round(float(cumulative[-1]), 3),
            "width": course.width,
            "depth": course.depth,
            "shore_width": course.shore_width,
            "shore_profile": course.shore_profile,
            "road_policy": course.road_policy,
            "smoothing": course.smoothing,
            "exit_enabled": course.exit_enabled,
            "flow_reversed": reversed_flow,
            "start_surface": round(float(surface_profile[0]), 3),
            "end_surface": round(float(surface_profile[-1]), 3),
            "water_cells": int(active_center.sum()),
            "road_cells": road_cells,
        })

    return WaterSystemResult(
        height=height,
        water_mask=water_mask,
        water_surface=water_surface,
        exit_mask=exit_mask,
        shore_mask=shore_mask,
        ford_mask=ford_mask,
        road_cut_mask=road_cut_mask,
        issues=issues,
        summaries=summaries,
    )
