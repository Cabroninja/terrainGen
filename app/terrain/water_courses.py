from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.ndimage import binary_dilation, distance_transform_edt

from app.core.models import ProjectConfig, WaterCourse


@dataclass(slots=True)
class WaterSystemResult:
    height: np.ndarray
    water_mask: np.ndarray
    water_surface: np.ndarray
    fall_mask: np.ndarray
    exit_mask: np.ndarray
    shore_mask: np.ndarray
    ford_mask: np.ndarray
    road_cut_mask: np.ndarray
    issues: list[dict]
    summaries: list[dict]


@dataclass(slots=True)
class WaterfallEvent:
    progress: float
    high_surface: float
    low_surface: float


@dataclass(slots=True)
class RiverPlan:
    points: np.ndarray
    cumulative: np.ndarray
    sampled_terrain: np.ndarray
    surface_profile: np.ndarray
    waterfalls: list[WaterfallEvent]
    user_total_length: float
    reversed_flow: bool
    issues: list[dict]
    modification_cost: float


STYLE_SETTINGS = {
    "calm": {
        "label": "Tranquilo",
        "gentle_ratio": 22.0,
        "waterfall_threshold": 7.0,
        "pool_length": 1.55,
        "pool_width": 1.45,
        "max_fill": 4.0,
    },
    "natural": {
        "label": "Natural",
        "gentle_ratio": 14.0,
        "waterfall_threshold": 4.0,
        "pool_length": 1.30,
        "pool_width": 1.25,
        "max_fill": 5.0,
    },
    "mountain": {
        "label": "Montañoso",
        "gentle_ratio": 8.0,
        "waterfall_threshold": 3.0,
        "pool_length": 1.05,
        "pool_width": 1.10,
        "max_fill": 6.0,
    },
}


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


def _clean_points(course: WaterCourse, profile_height: np.ndarray) -> tuple[np.ndarray, float, list[dict]]:
    issues: list[dict] = []
    points = np.asarray([(point.x, point.z) for point in course.points], dtype=np.float32)
    if points.shape[0] < 2:
        return points, 0.0, issues

    vectors = points[1:] - points[:-1]
    segment_lengths = np.sqrt(np.sum(vectors * vectors, axis=1))
    useful = np.concatenate(([True], segment_lengths > 0.25))
    points = points[useful]
    if points.shape[0] < 2:
        return points, 0.0, issues

    user_total_length = float(np.sqrt(np.sum((points[1:] - points[:-1]) ** 2, axis=1)).sum())
    if course.exit_enabled:
        direction = points[-1] - points[-2]
        if float(np.linalg.norm(direction)) <= 1e-6:
            direction = np.asarray([1.0, 0.0], dtype=np.float32)
        boundary = _nearest_boundary_point(points[-1], direction, profile_height.shape[1], profile_height.shape[0])
        if float(np.linalg.norm(boundary - points[-1])) > 0.5:
            points = np.vstack([points, boundary])
    return points, user_total_length, issues


def _densify_points(points: np.ndarray, spacing: float = 1.0, maximum_points: int = 8192) -> tuple[np.ndarray, np.ndarray]:
    if points.shape[0] < 2:
        return points.astype(np.float32, copy=True), np.zeros(points.shape[0], dtype=np.float32)
    output = [points[0].astype(np.float32)]
    for start, end in zip(points[:-1], points[1:], strict=True):
        delta = end - start
        length = float(np.linalg.norm(delta))
        if length <= 1e-6:
            continue
        steps = max(1, int(np.ceil(length / max(0.25, spacing))))
        for step in range(1, steps + 1):
            output.append((start + delta * (step / steps)).astype(np.float32))
            if len(output) >= maximum_points:
                break
        if len(output) >= maximum_points:
            break
    dense = np.asarray(output, dtype=np.float32)
    lengths = np.sqrt(np.sum((dense[1:] - dense[:-1]) ** 2, axis=1)) if dense.shape[0] > 1 else np.zeros(0)
    cumulative = np.concatenate(([0.0], np.cumsum(lengths))).astype(np.float32)
    return dense, cumulative


def _point_tangents(points: np.ndarray) -> np.ndarray:
    tangents = np.zeros_like(points, dtype=np.float32)
    if points.shape[0] < 2:
        tangents[:, 0] = 1.0
        return tangents
    tangents[0] = points[1] - points[0]
    tangents[-1] = points[-1] - points[-2]
    if points.shape[0] > 2:
        tangents[1:-1] = points[2:] - points[:-2]
    norms = np.linalg.norm(tangents, axis=1)
    safe = norms > 1e-6
    tangents[safe] /= norms[safe, None]
    tangents[~safe, 0] = 1.0
    return tangents


def _sample_corridor_height(height: np.ndarray, points: np.ndarray, width: int) -> np.ndarray:
    tangents = _point_tangents(points)
    half_width = max(1.0, float(width) / 2.0)
    offsets = np.asarray([-0.75, -0.35, 0.0, 0.35, 0.75], dtype=np.float32) * half_width
    samples = np.empty((points.shape[0], offsets.size), dtype=np.float32)
    for index, (point, tangent) in enumerate(zip(points, tangents, strict=True)):
        normal = np.asarray([-tangent[1], tangent[0]], dtype=np.float32)
        for offset_index, offset in enumerate(offsets):
            sample = point + normal * float(offset)
            samples[index, offset_index] = _sample_height(height, float(sample[0]), float(sample[1]))
    return np.median(samples, axis=1).astype(np.float32)


def _isotonic_nonincreasing(values: np.ndarray) -> np.ndarray:
    """Least-squares non-increasing fit using the pool-adjacent-violators algorithm."""
    if values.size <= 1:
        return values.astype(np.float32, copy=True)
    blocks: list[list[float | int]] = []
    for index, raw in enumerate(values.astype(np.float64)):
        blocks.append([float(raw), 1.0, index, index])  # sum, weight, start, end
        while len(blocks) >= 2:
            previous = blocks[-2][0] / blocks[-2][1]
            current = blocks[-1][0] / blocks[-1][1]
            if previous + 1e-9 >= current:
                break
            right = blocks.pop()
            left = blocks.pop()
            blocks.append([
                float(left[0]) + float(right[0]),
                float(left[1]) + float(right[1]),
                int(left[2]),
                int(right[3]),
            ])
    result = np.empty(values.size, dtype=np.float32)
    for total, weight, start, end in blocks:
        result[int(start): int(end) + 1] = float(total) / float(weight)
    return result


def _style(course: WaterCourse) -> dict[str, float | str]:
    return STYLE_SETTINGS.get(course.river_style, STYLE_SETTINGS["natural"])


def _automatic_surface_profile(
    sampled: np.ndarray,
    cumulative: np.ndarray,
    course: WaterCourse,
) -> tuple[np.ndarray, list[WaterfallEvent], float]:
    settings = _style(course)
    smoothed = _moving_average(sampled, course.smoothing)

    # A slight downward bias favours carving a natural bed over building tall
    # embankments. The fill cap is then enforced and the monotonic fit repeated.
    target = smoothed - 0.75
    fitted = _isotonic_nonincreasing(target)
    maximum_fill = float(settings["max_fill"])
    for _ in range(3):
        fitted = np.minimum(fitted, smoothed + maximum_fill)
        fitted = _isotonic_nonincreasing(fitted)

    ratio = float(settings["gentle_ratio"])
    waterfall_threshold = float(settings["waterfall_threshold"])
    surface = np.empty_like(fitted, dtype=np.float32)
    surface[0] = fitted[0]
    waterfalls: list[WaterfallEvent] = []

    for index in range(1, fitted.size):
        distance = max(1e-4, float(cumulative[index] - cumulative[index - 1]))
        gentle_floor = float(surface[index - 1]) - distance / ratio
        candidate = max(float(fitted[index]), gentle_floor)
        unresolved_drop = candidate - float(fitted[index])
        direct_drop = float(surface[index - 1]) - float(fitted[index])

        # Small changes become a long, gentle bed. Once the unresolved vertical
        # difference is large enough, it becomes a true waterfall instead of a
        # steep diagonal river that cuts a plateau in half.
        if unresolved_drop >= waterfall_threshold and direct_drop >= waterfall_threshold:
            high = float(surface[index - 1])
            low = float(fitted[index])
            waterfalls.append(WaterfallEvent(float(cumulative[index]), high, low))
            surface[index] = low
        else:
            surface[index] = candidate

    # Cost is used only to choose the most natural direction when the user draws
    # without caring which endpoint is upstream.
    floor = surface - float(course.depth)
    cut = np.maximum(sampled - floor, 0.0)
    fill = np.maximum(floor - sampled, 0.0)
    cost = float(np.mean(cut * cut + fill * fill * 2.25) + len(waterfalls) * 8.0)
    return surface, waterfalls, cost


def _build_plan(course: WaterCourse, profile_height: np.ndarray) -> RiverPlan:
    raw_points, user_total_length, issues = _clean_points(course, profile_height)
    if raw_points.shape[0] < 2:
        return RiverPlan(raw_points, np.zeros(0, dtype=np.float32), np.zeros(0, dtype=np.float32), np.zeros(0, dtype=np.float32), [], user_total_length, False, issues, float("inf"))

    def candidate(points: np.ndarray, reversed_flow: bool) -> RiverPlan:
        dense, cumulative = _densify_points(points)
        sampled = _sample_corridor_height(profile_height, dense, course.width)
        surface, waterfalls, cost = _automatic_surface_profile(sampled, cumulative, course)
        return RiverPlan(dense, cumulative, sampled, surface, waterfalls, user_total_length, reversed_flow, list(issues), cost)

    forward = candidate(raw_points, False)
    if course.exit_enabled:
        if forward.sampled_terrain.size >= 2 and forward.sampled_terrain[0] + 0.5 < forward.sampled_terrain[-1]:
            forward.issues.append({
                "severity": "warning",
                "code": "water_exit_uphill",
                "message": f"El río «{course.label or course.id}» llega a su salida desde una cota más baja; el perfil automático excavará el recorrido para mantener el flujo.",
            })
        return forward

    reverse = candidate(raw_points[::-1].copy(), True)
    # Prefer the lower modification cost. A tiny endpoint-height tie-break keeps
    # the higher endpoint upstream when both alternatives are practically equal.
    if reverse.modification_cost + 0.25 < forward.modification_cost:
        return reverse
    if abs(reverse.modification_cost - forward.modification_cost) <= 0.25:
        forward_drop = float(forward.sampled_terrain[0] - forward.sampled_terrain[-1])
        reverse_drop = float(reverse.sampled_terrain[0] - reverse.sampled_terrain[-1])
        if reverse_drop > forward_drop:
            return reverse
    return forward


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


def _point_and_direction_at_progress(points: np.ndarray, cumulative: np.ndarray, target_progress: float) -> tuple[np.ndarray, np.ndarray]:
    target = float(np.clip(target_progress, float(cumulative[0]), float(cumulative[-1])))
    index = int(np.searchsorted(cumulative, target, side="right") - 1)
    index = max(0, min(index, points.shape[0] - 2))
    start = points[index]
    end = points[index + 1]
    segment_length = max(1e-6, float(cumulative[index + 1] - cumulative[index]))
    t = float(np.clip((target - float(cumulative[index])) / segment_length, 0.0, 1.0))
    point = start + (end - start) * t
    direction = end - start
    norm = float(np.linalg.norm(direction))
    direction = direction / norm if norm > 1e-6 else np.asarray([1.0, 0.0], dtype=np.float32)
    return point.astype(np.float32), direction.astype(np.float32)


def _apply_automatic_waterfalls(
    *,
    course: WaterCourse,
    plan: RiverPlan,
    progress: np.ndarray,
    distance: np.ndarray,
    gx: np.ndarray,
    gz: np.ndarray,
    x0: int,
    z0: int,
    half_width: float,
    terrain_slice: np.ndarray,
    road_slice: np.ndarray,
    local_mask: np.ndarray,
    local_surface: np.ndarray,
    local_fall: np.ndarray,
    local_shore: np.ndarray,
    local_cut: np.ndarray,
    issues: list[dict],
    map_width: int,
    map_length: int,
) -> dict:
    settings = _style(course)
    contained = 0
    curtain_cells = 0
    pool_cells = 0
    support_cells = 0
    heights: list[float] = []
    recesses: list[float] = []
    previous_waterfall_progress = 0.0

    for number, event in enumerate(plan.waterfalls, start=1):
        drop = max(0.0, event.high_surface - event.low_surface)
        if drop < 1.5:
            continue
        point, direction = _point_and_direction_at_progress(plan.points, plan.cumulative, event.progress)

        # cascade_incline_ratio == 0 preserves the exact vertical behaviour used
        # before v5.3.2. Positive 1:X values turn the narrow vertical curtain into
        # a short, steep chute recessed into the plateau. A lower X excavates
        # farther upstream; it never changes the ordinary river profile.
        incline_ratio = max(0.0, float(course.cascade_incline_ratio))
        available_upstream = max(0.0, float(event.progress) - previous_waterfall_progress - 1.0)
        requested_recess = drop / incline_ratio if incline_ratio > 1e-6 else 0.0
        recess = min(requested_recess, available_upstream, 32.0)
        if recess < 0.75:
            recess = 0.0

        if recess <= 0.0:
            curtain_half_length = max(0.55, min(1.25, float(course.width) * 0.10))
            waterfall_zone = (
                (np.abs(progress - event.progress) <= curtain_half_length)
                & (distance <= half_width + 1e-6)
            )
            waterfall_surface = np.full(progress.shape, event.high_surface, dtype=np.float32)
        else:
            waterfall_zone = (
                (progress >= event.progress - recess - 0.25)
                & (progress <= event.progress + 0.35)
                & (distance <= half_width + 1e-6)
            )
            upstream_fraction = np.clip((event.progress - progress) / max(recess, 1e-6), 0.0, 1.0)
            waterfall_surface = (
                event.low_surface + drop * _smoothstep(upstream_fraction)
            ).astype(np.float32)

        blocked = waterfall_zone & road_slice & (course.road_policy != "cut")
        active = waterfall_zone & ~blocked
        if not np.any(active):
            issues.append({
                "severity": "warning",
                "code": "waterfall_blocked",
                "message": f"La cascada {number} de «{course.label or course.id}» quedó bloqueada por un camino protegido.",
            })
            previous_waterfall_progress = float(event.progress)
            continue

        if recess <= 0.0:
            # Current selectable behaviour: one narrow column stores the complete
            # vertical drop. The exporter emits a source only at the top.
            terrain_slice[active] = event.low_surface - float(course.depth)
            local_surface[active] = int(round(event.high_surface))
        else:
            # Inclined cascade: excavate a constant-depth stepped chute into the
            # plateau. Each column follows the steep 1:X profile and is exported
            # as falling water below its source block.
            terrain_slice[active] = waterfall_surface[active] - float(course.depth)
            local_surface[active] = np.rint(waterfall_surface[active]).astype(np.int16)
        local_mask[active] = 1
        local_fall[active] = 1
        if course.road_policy == "cut":
            local_cut[active & road_slice] = 1

        # Shape a broken alcove instead of a cylindrical shell. A small amount
        # of targeted support still contains the water, but the surrounding
        # terrain is blended into an irregular rocky recess so the waterfall
        # does not look like the exposed side of a tube.
        dx = gx - float(point[0])
        dz = gz - float(point[1])
        longitudinal = dx * float(direction[0]) + dz * float(direction[1])
        lateral_signed = -dx * float(direction[1]) + dz * float(direction[0])
        lateral_abs = np.abs(lateral_signed)

        alcove_down = max(2.4, min(7.5, half_width + drop * 0.10 + 2.0))
        alcove_width = max(half_width + 2.4, half_width + float(course.shore_width) * 0.7 + min(4.0, drop * 0.10 + 1.4))

        if recess <= 0.0:
            # Preserve the v5.3.1 alcove exactly for the selectable Vertical mode.
            alcove_up = max(1.8, min(5.5, half_width + 1.2))
            long_norm = np.where(longitudinal < 0.0, longitudinal / alcove_up, longitudinal / alcove_down)
            side_norm = lateral_signed / alcove_width
            alcove = (long_norm ** 2 + side_norm ** 2 <= 1.0) & ~active & ~road_slice
            depth_bias = np.clip((longitudinal + alcove_up) / (alcove_up + alcove_down), 0.0, 1.0)
            side_bias = np.clip(1.0 - lateral_abs / alcove_width, 0.0, 1.0)
            alcove_ratio = np.clip(0.18 + 0.72 * depth_bias * (0.60 + 0.40 * side_bias), 0.0, 1.0)
            alcove_target = event.low_surface + drop * alcove_ratio
        else:
            # Extend the eroded recess upstream with the inclined chute. The wall
            # height follows the same 1:X profile, then rises organically toward
            # the outer edge instead of forming a cylindrical shell.
            alcove_up = recess + max(1.8, min(5.5, half_width + 1.2))
            long_norm = np.where(longitudinal < 0.0, longitudinal / alcove_up, longitudinal / alcove_down)
            side_norm = lateral_signed / alcove_width
            alcove = (long_norm ** 2 + side_norm ** 2 <= 1.0) & ~active & ~road_slice
            chute_fraction = np.clip(-longitudinal / max(recess, 1e-6), 0.0, 1.0)
            center_surface = event.low_surface + drop * _smoothstep(chute_fraction)
            center_surface = np.where(longitudinal < -recess, event.high_surface, center_surface)
            center_surface = np.where(longitudinal > 0.0, event.low_surface, center_surface)
            edge_fraction = np.clip(lateral_abs / max(alcove_width, 1e-6), 0.0, 1.0)
            rocky_lift = np.minimum(drop * 0.42, 1.5 + edge_fraction * (2.5 + drop * 0.18))
            alcove_target = center_surface + rocky_lift

        carve = alcove & (terrain_slice > alcove_target)
        terrain_slice[carve] = alcove_target[carve]
        local_shore[carve] = 1

        support_front = max(1.8, half_width * 0.35 + 1.0)
        support_outer = half_width + 1.5
        support_back = recess + 0.8 if recess > 0.0 else 0.8
        support = (
            (lateral_abs > half_width)
            & (lateral_abs <= support_outer)
            & (longitudinal >= -support_back)
            & (longitudinal <= support_front)
            & ~road_slice
        )
        lateral_ratio = np.clip((support_outer - lateral_abs) / max(1e-6, support_outer - half_width), 0.0, 1.0)
        if recess <= 0.0:
            front_ratio = np.clip(1.0 - np.maximum(longitudinal, 0.0) / max(1e-6, support_front), 0.0, 1.0)
            support_ratio = np.clip(0.30 + 0.45 * lateral_ratio * front_ratio, 0.0, 0.82)
            support_target = event.low_surface + drop * support_ratio
        else:
            chute_fraction = np.clip(-longitudinal / max(recess, 1e-6), 0.0, 1.0)
            bank_surface = event.low_surface + drop * _smoothstep(chute_fraction)
            bank_surface = np.where(longitudinal < -recess, event.high_surface, bank_surface)
            bank_surface = np.where(longitudinal > 0.0, event.low_surface, bank_surface)
            support_target = bank_surface + 0.35 + lateral_ratio * 0.65
        support_fill = support & (terrain_slice < support_target)
        terrain_slice[support_fill] = support_target[support_fill]
        local_shore[support_fill] = 1
        support_cells += int(support_fill.sum())

        # A rounded receiving pool starts below the curtain and reconnects with
        # the ordinary lower river. It replaces the triangular sheet seen when a
        # large height difference was interpolated as a diagonal surface.
        pool_length = max(3.0, min(12.0, (half_width + drop * 0.18 + 2.0) * float(settings["pool_length"])))
        pool_width = max(half_width + 1.0, (half_width + min(4.0, drop * 0.12 + 1.0)) * float(settings["pool_width"]))
        center = point + direction * min(3.0, max(1.0, half_width * 0.35))
        dx = gx - float(center[0])
        dz = gz - float(center[1])
        longitudinal = dx * float(direction[0]) + dz * float(direction[1])
        lateral_pool = -dx * float(direction[1]) + dz * float(direction[0])
        pool = (longitudinal / pool_length) ** 2 + (lateral_pool / pool_width) ** 2 <= 1.0
        pool &= longitudinal >= -pool_length * 0.65
        pool &= longitudinal <= pool_length
        pool &= ~active
        if course.road_policy != "cut":
            pool &= ~road_slice
        new_pool = pool & (local_mask == 0)
        terrain_slice[pool] = event.low_surface - float(course.depth) - 1.0
        local_mask[pool] = 1
        local_surface[pool] = int(round(event.low_surface))
        local_fall[pool] = 0
        if course.road_policy == "cut":
            local_cut[pool & road_slice] = 1

        ring = binary_dilation(pool, iterations=1) & ~pool & (local_mask == 0) & ~road_slice
        ring_fill = ring & (terrain_slice < event.low_surface)
        terrain_slice[ring_fill] = event.low_surface
        local_shore[ring_fill] = 1
        support_cells += int(ring_fill.sum())

        global_z, global_x = np.where(active)
        touches_border = bool(np.any(
            (global_x + x0 == 0)
            | (global_x + x0 == map_width - 1)
            | (global_z + z0 == 0)
            | (global_z + z0 == map_length - 1)
        ))
        if touches_border and not course.exit_enabled:
            issues.append({
                "severity": "warning",
                "code": "waterfall_border",
                "message": f"La cascada {number} de «{course.label or course.id}» toca el borde del mapa sin ser una salida autorizada.",
            })
        if np.any(blocked):
            issues.append({
                "severity": "warning",
                "code": "waterfall_road_gap",
                "message": f"La cascada {number} de «{course.label or course.id}» cruza un camino protegido; revisa ese punto.",
            })
        if not touches_border and not np.any(blocked):
            contained += 1
        curtain_cells += int(active.sum())
        pool_cells += int(new_pool.sum())
        heights.append(round(drop, 2))
        recesses.append(round(recess, 2))
        previous_waterfall_progress = float(event.progress)

    return {
        "detected": len(plan.waterfalls),
        "contained": contained,
        "cells": curtain_cells,
        "pool_cells": pool_cells,
        "support_cells": support_cells,
        "heights": heights,
        "recesses": recesses,
        "incline_ratio": float(course.cascade_incline_ratio),
    }


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
    """Compile painted water and automatically designed freehand rivers.

    The user controls only the horizontal route and visual style. The compiler
    determines direction, a gentle descending profile, excavation/fill, real
    waterfalls, plunge pools, banks and exits.
    """

    height = source_height.astype(np.float32, copy=True)
    water_mask = np.zeros(height.shape, dtype=np.uint8)
    water_surface = np.full(height.shape, -1, dtype=np.int16)
    fall_mask = np.zeros(height.shape, dtype=np.uint8)
    exit_mask = np.zeros(height.shape, dtype=np.uint8)
    shore_mask = np.zeros(height.shape, dtype=np.uint8)
    ford_mask = np.zeros(height.shape, dtype=np.uint8)
    road_cut_mask = np.zeros(height.shape, dtype=np.uint8)
    issues: list[dict] = []
    summaries: list[dict] = []

    mass_summary = _apply_mass_water(height, water_mask, water_surface, painted_water, roads, config, shore_mask, ford_mask, road_cut_mask)

    map_length, map_width = height.shape
    for course in courses:
        plan = _build_plan(course, profile_height)
        issues.extend(plan.issues)
        if plan.points.shape[0] < 2 or plan.cumulative.size < 2 or float(plan.cumulative[-1]) <= 1e-6:
            issues.append({
                "severity": "error",
                "code": "water_course_zero_length",
                "message": f"El río «{course.label or course.id}» no tiene un recorrido útil.",
            })
            continue

        half_width = float(course.width) / 2.0
        style_settings = _style(course)
        waterfall_margin = max(8.0, half_width + float(course.shore_width) + 6.0)
        outer_radius = max(half_width + float(course.shore_width), waterfall_margin if plan.waterfalls else 0.0)
        x0 = max(0, int(np.floor(plan.points[:, 0].min() - outer_radius - 1)))
        x1 = min(map_width - 1, int(np.ceil(plan.points[:, 0].max() + outer_radius + 1)))
        z0 = max(0, int(np.floor(plan.points[:, 1].min() - outer_radius - 1)))
        z1 = min(map_length - 1, int(np.ceil(plan.points[:, 1].max() + outer_radius + 1)))
        zz, xx = np.mgrid[z0:z1 + 1, x0:x1 + 1]
        gx = xx.astype(np.float32)
        gz = zz.astype(np.float32)
        distance, progress = _polyline_fields(plan.points, plan.cumulative, gx, gz)
        surface = np.interp(progress, plan.cumulative, plan.surface_profile).astype(np.float32)
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

        # Exact assignment lets the automatic profile both carve high ground and
        # add the missing bed beneath low ground. This is bounded to the river and
        # its configured shore, never the whole map.
        terrain_slice[normal] = floor[normal]
        surface_i = np.rint(surface).astype(np.int16)
        if np.any(ford):
            terrain_slice[ford] = before[ford]
            surface_i[ford] = np.rint(before[ford] + 1.0).astype(np.int16)

        local_ford = ford_mask[z0:z1 + 1, x0:x1 + 1]
        local_cut = road_cut_mask[z0:z1 + 1, x0:x1 + 1]
        local_ford[ford] = 1
        local_cut[cut] = 1

        local_mask = water_mask[z0:z1 + 1, x0:x1 + 1]
        local_surface = water_surface[z0:z1 + 1, x0:x1 + 1]
        local_fall = fall_mask[z0:z1 + 1, x0:x1 + 1]
        local_shore = shore_mask[z0:z1 + 1, x0:x1 + 1]
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
                # High original ground is carved toward one block below water.
                # Low ground is raised to the water level at the inner rim and
                # blended outward, containing Minecraft water without a straight
                # wall along the entire river.
                inner_target = np.where(before >= surface, surface - 1.0, surface)
                blended = before * (1.0 - influence) + inner_target * influence
                terrain_slice[shore] = blended[shore]
                local_shore[shore] = 1

        waterfall_summary = _apply_automatic_waterfalls(
            course=course,
            plan=plan,
            progress=progress,
            distance=distance,
            gx=gx,
            gz=gz,
            x0=x0,
            z0=z0,
            half_width=half_width,
            terrain_slice=terrain_slice,
            road_slice=road_slice,
            local_mask=local_mask,
            local_surface=local_surface,
            local_fall=local_fall,
            local_shore=local_shore,
            local_cut=local_cut,
            issues=issues,
            map_width=map_width,
            map_length=map_length,
        )

        if course.exit_enabled:
            local_exit = exit_mask[z0:z1 + 1, x0:x1 + 1]
            local_exit[active_center & (progress >= plan.user_total_length - 1e-3)] = 1

        center_cut = np.maximum(before[active_center] - terrain_slice[active_center], 0.0)
        center_fill = np.maximum(terrain_slice[active_center] - before[active_center], 0.0)
        maximum_cut = float(center_cut.max()) if center_cut.size else 0.0
        maximum_fill = float(center_fill.max()) if center_fill.size else 0.0
        if maximum_cut > 18.0:
            issues.append({
                "severity": "warning",
                "code": "water_auto_deep_cut",
                "message": f"El río «{course.label or course.id}» necesitó una excavación máxima de {maximum_cut:.1f} bloques. Revisa el recorrido si atraviesa una elevación cerrada entre dos zonas bajas.",
            })
        if maximum_fill > 10.0:
            issues.append({
                "severity": "warning",
                "code": "water_auto_high_fill",
                "message": f"El río «{course.label or course.id}» necesitó un soporte máximo de {maximum_fill:.1f} bloques. Revisa el recorrido si cruza una depresión muy profunda.",
            })

        road_cells = int((active_center & road_slice).sum())
        summaries.append({
            "id": course.id,
            "label": course.label,
            "length": round(float(plan.cumulative[-1]), 3),
            "width": course.width,
            "depth": course.depth,
            "shore_width": course.shore_width,
            "shore_profile": course.shore_profile,
            "road_policy": course.road_policy,
            "river_style": course.river_style,
            "style_label": style_settings["label"],
            "cascades_detected": waterfall_summary["detected"],
            "cascades_contained": waterfall_summary["contained"],
            "cascade_cells": waterfall_summary["cells"],
            "plunge_pool_cells": waterfall_summary["pool_cells"],
            "cascade_support_cells": waterfall_summary["support_cells"],
            "waterfall_heights": waterfall_summary["heights"],
            "waterfall_recesses": waterfall_summary["recesses"],
            "cascade_incline_ratio": waterfall_summary["incline_ratio"],
            "maximum_excavation": round(maximum_cut, 3),
            "maximum_fill": round(maximum_fill, 3),
            "smoothing": course.smoothing,
            "exit_enabled": course.exit_enabled,
            "flow_reversed": plan.reversed_flow,
            "start_surface": round(float(plan.surface_profile[0]), 3),
            "end_surface": round(float(plan.surface_profile[-1]), 3),
            "water_cells": int(active_center.sum()) + int(waterfall_summary["pool_cells"]),
            "road_cells": road_cells,
        })

    return WaterSystemResult(
        height=height,
        water_mask=water_mask,
        water_surface=water_surface,
        fall_mask=fall_mask,
        exit_mask=exit_mask,
        shore_mask=shore_mask,
        ford_mask=ford_mask,
        road_cut_mask=road_cut_mask,
        issues=issues,
        summaries=summaries,
    )
