from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.ndimage import label

from app.core.models import ProjectDocument
from app.core.rle import decode_rle_u8
from app.terrain.mountain_border import generate_mountain_border
from app.terrain.road_ramps import apply_road_ramps
from app.terrain.water_courses import apply_water_system
from app.structures import apply_structure_placements
from types import SimpleNamespace


@dataclass(slots=True)
class CompiledTerrain:
    height: np.ndarray
    material: np.ndarray
    road_mask: np.ndarray
    water_mask: np.ndarray
    water_surface: np.ndarray
    water_fall_mask: np.ndarray
    water_exit_mask: np.ndarray
    playable_mask: np.ndarray
    reserved_mask: np.ndarray
    mountain_mask: np.ndarray
    exit_corridor_mask: np.ndarray
    slope: np.ndarray
    walkable: np.ndarray
    validation: dict
    markers: list[dict]
    block_palette: dict[str, int]
    structure_blocks_by_y: dict[int, dict[int, int]]


def _decode_layers(project: ProjectDocument) -> dict[str, np.ndarray]:
    shape = (project.config.length, project.config.width)
    total = shape[0] * shape[1]
    return {
        name: decode_rle_u8(layer.data, total).reshape(shape)
        for name, layer in project.layers.items()
    }


def _detect_edge_road_exits(roads: np.ndarray) -> list[dict]:
    contacts: list[dict] = []
    length, width = roads.shape
    sides = {
        "north": np.flatnonzero(roads[0] > 0),
        "south": np.flatnonzero(roads[-1] > 0),
        "west": np.flatnonzero(roads[:, 0] > 0),
        "east": np.flatnonzero(roads[:, -1] > 0),
    }
    for side, indices in sides.items():
        if indices.size == 0:
            continue
        groups = np.split(indices, np.where(np.diff(indices) > 2)[0] + 1)
        for group in groups:
            position = int(round(float(group.mean())))
            if side == "north":
                marker = {"source": "road_edge", "side": side, "x": position, "z": 0}
            elif side == "south":
                marker = {"source": "road_edge", "side": side, "x": position, "z": length - 1}
            elif side == "west":
                marker = {"source": "road_edge", "side": side, "x": 0, "z": position}
            else:
                marker = {"source": "road_edge", "side": side, "x": width - 1, "z": position}
            if not any((marker["x"] - old["x"]) ** 2 + (marker["z"] - old["z"]) ** 2 <= 16 for old in contacts):
                contacts.append(marker)
    return contacts


def _validation(
    project: ProjectDocument,
    height: np.ndarray,
    roads: np.ndarray,
    water: np.ndarray,
    playable: np.ndarray,
    walkable: np.ndarray,
    resolved_exits: list[dict],
    mountain_issues: list[dict],
    mountain_mask: np.ndarray,
    corridor_mask: np.ndarray,
    road_ramp_issues: list[dict],
    road_ramp_summaries: list[dict],
    water_issues: list[dict],
    water_summaries: list[dict],
    water_exit_mask: np.ndarray,
    structure_issues: list[dict],
    structure_summaries: list[dict],
    structure_placed_blocks: int,
) -> dict:
    edge_exits = _detect_edge_road_exits(roads)
    marker_exits = [
        {
            "source": "marker",
            "id": item["id"],
            "label": item["label"],
            "x": item["boundary_x"],
            "z": item["boundary_z"],
            "marker_x": item["x"],
            "marker_z": item["z"],
        }
        for item in resolved_exits
    ]
    exits = marker_exits if project.config.mountain_border_enabled else edge_exits
    if not exits:
        exits = edge_exits

    _, road_count = label(roads > 0, structure=np.ones((3, 3), dtype=np.uint8))
    road_steps: list[float] = []
    if np.any(roads > 0):
        horizontal = np.abs(np.diff(height, axis=1))
        vertical = np.abs(np.diff(height, axis=0))
        road_steps.extend(horizontal[(roads[:, 1:] > 0) & (roads[:, :-1] > 0)].tolist())
        road_steps.extend(vertical[(roads[1:, :] > 0) & (roads[:-1, :] > 0)].tolist())
    playable_count = max(1, int((playable > 0).sum()))
    issues: list[dict] = [*mountain_issues, *road_ramp_issues, *water_issues, *structure_issues]
    if not exits:
        message = "No hay marcadores de salida resueltos." if project.config.mountain_border_enabled else "Ningún camino toca el borde del mapa."
        issues.append({"severity": "error", "code": "no_exits", "message": message})
    if road_count > 1:
        issues.append({"severity": "warning", "code": "road_components", "message": f"La red vial tiene {road_count} componentes separados."})
    max_step = float(max(road_steps, default=0.0))
    if max_step > 1.5:
        issues.append({"severity": "warning", "code": "road_step", "message": f"El mayor salto continuo del camino es {max_step:.2f} bloques."})
    flooded_roads = int(((roads > 0) & (water > 0)).sum())
    if flooded_roads:
        issues.append({"severity": "warning", "code": "flooded_roads", "message": f"Hay {flooded_roads} celdas de camino pintadas como agua."})
    for marker in project.markers:
        if marker.type in {"spawn", "poi"} and not walkable[marker.z, marker.x]:
            issues.append({"severity": "warning", "code": "marker_unwalkable", "message": f"El marcador «{marker.label or marker.id}» quedó en terreno no transitable."})
    status = "ok" if not any(issue["severity"] == "error" for issue in issues) else "error"
    return {
        "status": status,
        "dimensions": {
            "width": project.config.width,
            "length": project.config.length,
            "schematic_height": project.config.schematic_height,
            "voxels": project.config.width * project.config.length * project.config.schematic_height,
        },
        "detected_exits": exits,
        "resolved_mountain_exits": resolved_exits,
        "road_components": int(road_count),
        "maximum_road_step": round(max_step, 3),
        "walkable_ratio": round(float(walkable.sum()) / playable_count, 4),
        "playable_cells": int((playable > 0).sum()),
        "water_cells": int((water > 0).sum()),
        "mountain_border": {
            "enabled": project.config.mountain_border_enabled,
            "cells": int((mountain_mask > 0.20).sum()),
            "strong_cells": int((mountain_mask > 0.60).sum()),
            "corridor_cells": int((corridor_mask > 0).sum()),
        },
        "road_ramps": {
            "count": sum(1 for item in road_ramp_summaries if item.get("kind", "road") == "road"),
            "valid": sum(1 for item in road_ramp_summaries if item.get("kind", "road") == "road" and item["valid"]),
            "items": [item for item in road_ramp_summaries if item.get("kind", "road") == "road"],
        },
        "terrain_ramps": {
            "count": sum(1 for item in road_ramp_summaries if item.get("kind") == "terrain"),
            "valid": sum(1 for item in road_ramp_summaries if item.get("kind") == "terrain" and item["valid"]),
            "items": [item for item in road_ramp_summaries if item.get("kind") == "terrain"],
        },
        "water_system": {
            "course_count": len(water_summaries),
            "exit_count": sum(1 for item in water_summaries if item["exit_enabled"]),
            "exit_cells": int((water_exit_mask > 0).sum()),
            "cascade_count": sum(int(item.get("cascades_detected", 0)) for item in water_summaries),
            "contained_cascades": sum(int(item.get("cascades_contained", 0)) for item in water_summaries),
            "items": water_summaries,
        },
        "structures": {
            "collection_count": len(structure_summaries),
            "instance_count": len(project.structure_placements),
            "placed_blocks": int(structure_placed_blocks),
            "items": structure_summaries,
        },
        "issues": issues,
    }


def compile_project(project: ProjectDocument) -> CompiledTerrain:
    config = project.config
    layers = _decode_layers(project)
    playable = layers["playable"] >= 128
    painted_roads = layers["roads"]
    water = layers["water"] > 0
    reserved = layers["reserved"] > 0

    base = config.min_height + (layers["height_base"].astype(np.float32) / 255.0) * (config.max_height - config.min_height)
    modifier = ((layers["height_modifier"].astype(np.float32) - 128.0) / 127.0) * config.height_modifier_range
    height = np.clip(base + modifier, config.min_height, config.max_height).astype(np.float32)

    # Las rampas son objetos explícitos y acotados. Las viales también pintan
    # camino; las de meseta solo modifican el relieve dentro de su corredor.
    ramp_result = apply_road_ramps(height, painted_roads, project.road_ramps)
    height = ramp_result.height
    roads = ramp_result.road_mask

    # El perfil de los ríos se toma desde el relieve diseñado (incluidas rampas)
    # antes de levantar la cordillera. Así una salida puede prolongarse por el
    # borde sin que la montaña obligue al agua a subir.
    water_profile_height = height.copy()
    height_before_mountain = height.copy()
    mountain = generate_mountain_border(height, playable, config, project.markers)

    # Barrera de aislamiento: el borde montañoso solo puede cambiar celdas donde
    # su máscara o un corredor de salida tengan influencia real. El interior del
    # mapa conserva exactamente Altura base + Modificador, incluso si el módulo
    # montañoso utiliza filtros espaciales para construir la cordillera.
    mountain_active = (mountain.strength > 1e-6) | (mountain.corridor_influence > 1e-6)
    height = np.where(mountain_active, mountain.height, height_before_mountain).astype(np.float32)

    # El agua se compila después de la cordillera. Las masas usan la máscara
    # pintada; los ríos libres son objetos con nivel por celda, profundidad,
    # orilla y salida explícita. Solo su corredor puede excavar el borde.
    water_result = apply_water_system(
        height,
        water_profile_height,
        water,
        roads,
        project.water_courses,
        config,
    )
    height = water_result.height
    water = water_result.water_mask > 0
    if np.any(water_result.road_cut_mask):
        roads = roads.copy()
        roads[water_result.road_cut_mask > 0] = 0

    export_playable = playable | (water_result.exit_mask > 0)

    # Flujo limpio de relieve: caminos y zonas reservadas son capas lógicas/materiales.
    # No aplanan, suavizan ni levantan el terreno durante la compilación.
    # La única falda exterior de una meseta se pinta explícitamente desde Altura base.
    height = np.clip(height, 1, config.schematic_height - 2)
    height_i = np.rint(height).astype(np.int16)

    dz, dx = np.gradient(height.astype(np.float32))
    slope = np.sqrt(dx * dx + dz * dz).astype(np.float32)
    walkable = playable & ~water & (slope <= config.max_walk_slope)
    walkable |= (roads > 0) & playable & (~water | (water_result.ford_mask > 0))
    walkable |= reserved & playable

    manual = layers["materials"]
    material = np.zeros_like(manual, dtype=np.uint8)
    material[:] = 1
    material[slope > 1.8] = 3
    material[height_i >= config.max_height - 8] = 5
    material[mountain.strength > 0.52] = 3
    shore_mask = (water_result.shore_mask > 0) & ~water
    material[shore_mask] = 4
    material[roads == 1] = 6
    material[roads == 2] = 2
    manual_override = (manual > 0) & playable & (mountain.strength < 0.70)
    material[manual_override] = manual[manual_override]
    material[water] = 7
    material[(water_result.ford_mask > 0) & (roads == 1)] = 6
    material[(water_result.ford_mask > 0) & (roads == 2)] = 2
    material[~export_playable] = 3

    # Las estructuras se resuelven al final sobre la altura compilada. No alteran
    # el relieve: solo aportan bloques adicionales para la Vista Minecraft y el .schem.
    structure_result = apply_structure_placements(project, SimpleNamespace(height=height_i))

    validation = _validation(
        project,
        height.astype(np.float32),
        roads,
        water,
        playable,
        walkable,
        mountain.resolved_exits,
        mountain.issues,
        mountain.strength,
        mountain.corridor_mask,
        ramp_result.issues,
        ramp_result.summaries,
        water_result.issues,
        water_result.summaries,
        water_result.exit_mask,
        structure_result.issues,
        structure_result.summaries,
        structure_result.placed_blocks,
    )
    return CompiledTerrain(
        height=height_i,
        material=material,
        road_mask=roads,
        water_mask=water.astype(np.uint8),
        water_surface=water_result.water_surface.astype(np.int16),
        water_fall_mask=water_result.fall_mask.astype(np.uint8),
        water_exit_mask=water_result.exit_mask.astype(np.uint8),
        playable_mask=export_playable.astype(np.uint8),
        reserved_mask=reserved.astype(np.uint8),
        mountain_mask=mountain.strength.astype(np.float32),
        exit_corridor_mask=mountain.corridor_mask.astype(np.uint8),
        slope=slope,
        walkable=walkable.astype(np.uint8),
        validation=validation,
        markers=[marker.model_dump() for marker in project.markers],
        block_palette=structure_result.palette,
        structure_blocks_by_y=structure_result.blocks_by_y,
    )
