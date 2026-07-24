from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.ndimage import binary_erosion, distance_transform_edt, gaussian_filter, minimum_filter

from app.core.models import Marker, ProjectConfig


@dataclass(slots=True)
class MountainBorderResult:
    height: np.ndarray
    strength: np.ndarray
    corridor_mask: np.ndarray
    corridor_influence: np.ndarray
    resolved_exits: list[dict]
    issues: list[dict]
    clipped_cells: int


def _smoothstep(value: np.ndarray) -> np.ndarray:
    value = np.clip(value, 0.0, 1.0)
    return value * value * (3.0 - 2.0 * value)


def _noise(shape: tuple[int, int], rng: np.random.Generator, sigma: float) -> np.ndarray:
    values = rng.normal(0.0, 1.0, size=shape).astype(np.float32)
    values = gaussian_filter(values, sigma=max(0.6, float(sigma)), mode="reflect")
    deviation = float(values.std())
    if deviation > 1e-6:
        values = values / deviation
    return np.clip(values / 2.75, -1.0, 1.0).astype(np.float32)




def _lower_envelope(values: np.ndarray, radius: float) -> np.ndarray:
    """Return a smooth terrain floor that cannot inherit positive plateaus.

    It is used only to choose the vertical target of exit corridors. Mountain
    height itself is added cell-by-cell to the original terrain, so no painted
    elevation can spread laterally into neighbouring grass.
    """
    radius = max(1.0, float(radius))
    size = max(3, int(np.ceil(radius)) * 2 + 1)
    floor = minimum_filter(values, size=size, mode="reflect").astype(np.float32)
    return gaussian_filter(floor, sigma=max(0.8, radius * 0.18), mode="reflect").astype(np.float32)

def _playable_boundary(playable: np.ndarray) -> np.ndarray:
    eroded = binary_erosion(playable, structure=np.ones((3, 3), dtype=bool), border_value=0)
    return playable & ~eroded


def _nearest_boundary(
    boundary_points: np.ndarray,
    marker: Marker,
) -> tuple[int, int]:
    dz = boundary_points[:, 0].astype(np.float32) - float(marker.z)
    dx = boundary_points[:, 1].astype(np.float32) - float(marker.x)
    index = int(np.argmin(dx * dx + dz * dz))
    return int(boundary_points[index, 0]), int(boundary_points[index, 1])


def _inward_direction(
    boundary_z: int,
    boundary_x: int,
    inside_distance: np.ndarray,
    playable: np.ndarray,
) -> tuple[float, float]:
    grad_z, grad_x = np.gradient(inside_distance.astype(np.float32))
    vx = float(grad_x[boundary_z, boundary_x])
    vz = float(grad_z[boundary_z, boundary_x])
    length = float(np.hypot(vx, vz))
    if length < 0.08:
        points = np.argwhere(playable)
        center_z, center_x = points.mean(axis=0)
        vx = float(center_x - boundary_x)
        vz = float(center_z - boundary_z)
        length = float(np.hypot(vx, vz))
    if length < 1e-6:
        return 0.0, 1.0
    return vx / length, vz / length


def generate_mountain_border(
    height: np.ndarray,
    playable: np.ndarray,
    config: ProjectConfig,
    markers: list[Marker],
) -> MountainBorderResult:
    """Generate a reproducible mountain ring from the playable mask.

    The source height and painted layers remain untouched. The returned height is
    a compiled derivative. Exit markers carve tapered corridors through the ring.
    """
    original = height.astype(np.float32, copy=True)
    empty_strength = np.zeros_like(original, dtype=np.float32)
    empty_corridors = np.zeros_like(playable, dtype=np.uint8)
    if not config.mountain_border_enabled:
        return MountainBorderResult(original, empty_strength, empty_corridors, empty_strength.copy(), [], [], 0)

    issues: list[dict] = []
    exterior = ~playable
    boundary = _playable_boundary(playable)
    if not np.any(playable):
        issues.append({
            "severity": "error",
            "code": "mountain_no_playable_area",
            "message": "El borde montañoso está activo, pero la capa Límite jugable no contiene una zona interior.",
        })
        return MountainBorderResult(original, empty_strength, empty_corridors, empty_strength.copy(), [], issues, 0)
    if not np.any(boundary):
        issues.append({
            "severity": "error",
            "code": "mountain_no_boundary",
            "message": "No fue posible detectar un contorno para generar el borde montañoso.",
        })
        return MountainBorderResult(original, empty_strength, empty_corridors, empty_strength.copy(), [], issues, 0)

    if not np.any(exterior):
        issues.append({
            "severity": "error",
            "code": "mountain_no_margin",
            "message": "Todo el lienzo está marcado como jugable. Usa «Preparar margen automático» para reservar espacio exterior.",
        })
        return MountainBorderResult(original, empty_strength, empty_corridors, empty_strength.copy(), [], issues, 0)

    edge_contact = bool(
        np.any(playable[0]) or np.any(playable[-1]) or np.any(playable[:, 0]) or np.any(playable[:, -1])
    )
    if edge_contact:
        issues.append({
            "severity": "warning",
            "code": "mountain_edge_contact",
            "message": "Parte del límite jugable toca el borde del lienzo; en esas zonas la cordillera tendrá menos espacio exterior.",
        })

    inside_distance = np.maximum(distance_transform_edt(playable) - 1.0, 0.0).astype(np.float32)
    outside_distance = np.maximum(distance_transform_edt(exterior) - 1.0, 0.0).astype(np.float32)

    rng = np.random.default_rng(int(config.seed) ^ 0x4A4B52)
    low_noise = _noise(original.shape, rng, sigma=max(3.0, config.mountain_outer_width * 0.32))
    rough_noise = _noise(original.shape, rng, sigma=max(0.8, config.mountain_outer_width * 0.055))
    irregularity = config.mountain_irregularity / 100.0
    roughness = config.mountain_roughness / 100.0

    outside_effective = np.maximum(
        0.0,
        outside_distance - low_noise * float(config.mountain_outer_width) * 0.18 * irregularity,
    )
    inside_effective = np.maximum(
        0.0,
        inside_distance + low_noise * float(config.mountain_inner_transition) * 0.10 * irregularity,
    )

    inner = np.zeros_like(original, dtype=np.float32)
    inner[playable] = _smoothstep(
        1.0 - inside_effective[playable] / max(1.0, float(config.mountain_inner_transition))
    ) * 0.78

    normalized_outside = outside_effective / max(1.0, float(config.mountain_outer_width))
    ridge = np.exp(-((normalized_outside - 0.36) / 0.43) ** 2).astype(np.float32)
    outside_profile = np.where(
        normalized_outside <= 1.0,
        0.56 + 0.44 * ridge,
        np.clip(0.56 - (normalized_outside - 1.0) * 0.12, 0.36, 0.56),
    ).astype(np.float32)

    strength = np.where(playable, inner, outside_profile).astype(np.float32)
    strength = np.clip(strength, 0.0, 1.0)

    zz, xx = np.indices(original.shape, dtype=np.float32)
    boundary_points = np.argwhere(boundary)
    corridor_cut = np.zeros_like(original, dtype=np.float32)
    corridor_target_sum = np.zeros_like(original, dtype=np.float32)
    corridor_weight_sum = np.zeros_like(original, dtype=np.float32)
    resolved_exits: list[dict] = []

    # Los corredores toman una referencia baja y robusta. Un pico o una meseta
    # cercana no puede elevar el objetivo vertical de una salida.
    corridor_source = _lower_envelope(
        original,
        radius=max(2.0, config.mountain_inner_transition * 0.42),
    )

    for marker in (item for item in markers if item.type == "exit"):
        boundary_z, boundary_x = _nearest_boundary(boundary_points, marker)
        inward_x, inward_z = _inward_direction(boundary_z, boundary_x, inside_distance, playable)
        dx = xx - float(boundary_x)
        dz = zz - float(boundary_z)
        longitudinal = dx * inward_x + dz * inward_z
        lateral = np.abs(-dx * inward_z + dz * inward_x)

        outside_extent = max(float(config.mountain_outer_width) * 1.20, float(config.mountain_exit_width) * 1.5)
        inside_extent = float(config.mountain_exit_transition)
        base_half_width = max(2.0, float(config.mountain_exit_width) / 2.0)
        outward_ratio = np.clip(-longitudinal / max(1.0, outside_extent), 0.0, 1.0)
        clear_half_width = base_half_width * (1.0 + 0.34 * outward_ratio)
        side_feather = max(5.0, float(config.mountain_exit_width) * 0.82) * (1.0 + 0.22 * outward_ratio)
        lateral_factor = np.ones_like(lateral, dtype=np.float32)
        feather_zone = lateral > clear_half_width
        lateral_factor[feather_zone] = _smoothstep(
            1.0 - (lateral[feather_zone] - clear_half_width[feather_zone]) / np.maximum(side_feather[feather_zone], 1.0)
        )
        lateral_factor[lateral >= clear_half_width + side_feather] = 0.0
        outside_fade = _smoothstep((longitudinal + outside_extent) / max(1.0, outside_extent * 0.22))
        inside_fade = _smoothstep((inside_extent - longitudinal) / max(1.0, inside_extent * 0.28))
        longitudinal_mask = (
            (longitudinal >= -outside_extent)
            & (longitudinal <= inside_extent)
        )
        cut = lateral_factor * outside_fade * inside_fade * longitudinal_mask.astype(np.float32)
        corridor_cut = np.maximum(corridor_cut, cut)

        sample_x = int(np.clip(round(boundary_x + inward_x * inside_extent * 0.72), 0, original.shape[1] - 1))
        sample_z = int(np.clip(round(boundary_z + inward_z * inside_extent * 0.72), 0, original.shape[0] - 1))
        interior_target = float(corridor_source[sample_z, sample_x])
        outside_drop = np.clip(-longitudinal / max(1.0, outside_extent), 0.0, 1.0) * 2.0
        target = interior_target - outside_drop
        target_weight = np.power(cut, 1.35).astype(np.float32)
        corridor_target_sum += target * target_weight
        corridor_weight_sum += target_weight

        resolved_exits.append({
            "id": marker.id,
            "label": marker.label,
            "x": marker.x,
            "z": marker.z,
            "boundary_x": boundary_x,
            "boundary_z": boundary_z,
            "inward_x": round(inward_x, 4),
            "inward_z": round(inward_z, 4),
            "width": config.mountain_exit_width,
            "transition": config.mountain_exit_transition,
        })

    strength *= 1.0 - np.clip(corridor_cut, 0.0, 1.0)

    variation = (
        1.0
        + low_noise * (0.34 * irregularity)
        + rough_noise * (0.16 * roughness)
    )
    variation = np.clip(variation, 0.66, 1.42)
    # Aislamiento estricto de elevaciones pintadas:
    # la cordillera se suma a la altura ORIGINAL de cada celda, sin desenfocar
    # ni muestrear alturas vecinas. Así una meseta solo puede cambiar las celdas
    # que fueron pintadas por su propio círculo blanco/verde.
    desired = original + float(config.mountain_height) * strength * variation
    active = strength > 1e-6
    result = np.where(active, np.maximum(original, desired), original).astype(np.float32)

    corridor_active = corridor_weight_sum > 1e-5
    if np.any(corridor_active):
        target = np.zeros_like(result, dtype=np.float32)
        target[corridor_active] = corridor_target_sum[corridor_active] / corridor_weight_sum[corridor_active]
        blend = np.clip(corridor_weight_sum, 0.0, 1.0)
        result = result * (1.0 - blend) + target * blend

    upper_limit = float(config.schematic_height - 2)
    clipped = result > upper_limit
    clipped_cells = int(clipped.sum())
    if clipped_cells:
        issues.append({
            "severity": "warning",
            "code": "mountain_clipped",
            "message": f"{clipped_cells} celdas del borde alcanzaron el techo vertical y fueron limitadas. Aumenta Altura Y o reduce Altura del borde.",
        })
    result = np.clip(result, 1.0, upper_limit).astype(np.float32)

    if not resolved_exits:
        issues.append({
            "severity": "warning",
            "code": "mountain_no_exit_markers",
            "message": "El borde montañoso no tiene marcadores de salida; la cordillera se generará cerrada.",
        })

    corridor_mask = (corridor_cut >= 0.42).astype(np.uint8)
    return MountainBorderResult(
        height=result,
        strength=strength.astype(np.float32),
        corridor_mask=corridor_mask,
        corridor_influence=np.clip(corridor_cut, 0.0, 1.0).astype(np.float32),
        resolved_exits=resolved_exits,
        issues=issues,
        clipped_cells=clipped_cells,
    )
