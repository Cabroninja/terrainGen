from __future__ import annotations

import base64
from dataclasses import dataclass
import re

import numpy as np

from app.core.models import ProjectDocument
from app.exporters.blocks import PALETTE
from .schematic_reader import ParsedSchematic, parse_schematic_bytes


@dataclass(slots=True)
class StructurePlacementResult:
    palette: dict[str, int]
    blocks_by_y: dict[int, dict[int, int]]
    issues: list[dict]
    summaries: list[dict]
    placed_blocks: int


def _rotate_position(dx: int, dz: int, rotation: int) -> tuple[int, int]:
    if rotation == 90:
        return -dz, dx
    if rotation == 180:
        return -dx, -dz
    if rotation == 270:
        return dz, -dx
    return dx, dz


def _replace_property(state: str, key: str, transform) -> str:
    if "[" not in state:
        return state
    base, raw = state[:-1].split("[", 1)
    pairs = []
    changed = False
    for item in raw.split(","):
        if "=" not in item:
            pairs.append(item)
            continue
        prop, value = item.split("=", 1)
        if prop == key:
            value = transform(value)
            changed = True
        pairs.append(f"{prop}={value}")
    return f"{base}[{','.join(pairs)}]" if changed else state


def _rotate_state(state: str, rotation: int, mirror: bool) -> str:
    facing_order = ["north", "east", "south", "west"]
    quarter = (rotation // 90) % 4
    if mirror:
        state = _replace_property(state, "facing", lambda value: {"east": "west", "west": "east"}.get(value, value))
        state = _replace_property(state, "axis", lambda value: value)
        state = _replace_property(state, "rotation", lambda value: str((-int(value)) % 16) if value.isdigit() else value)
        state = _replace_property(state, "shape", lambda value: value.replace("left", "__tmp__").replace("right", "left").replace("__tmp__", "right"))
    if quarter:
        def rotate_facing(value: str) -> str:
            return facing_order[(facing_order.index(value) + quarter) % 4] if value in facing_order else value
        state = _replace_property(state, "facing", rotate_facing)
        if quarter % 2:
            state = _replace_property(state, "axis", lambda value: "z" if value == "x" else "x" if value == "z" else value)
        state = _replace_property(state, "rotation", lambda value: str((int(value) + quarter * 4) % 16) if value.isdigit() else value)
    return state


def _asset_from_model(asset) -> ParsedSchematic:
    try:
        raw = base64.b64decode(asset.content_b64, validate=True)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"El asset {asset.label} contiene base64 inválido.") from exc
    return parse_schematic_bytes(raw)


def block_color_for_state(state: str) -> tuple[float, float, float, float]:
    name = state.split("[", 1)[0]
    if "leaves" in name or "moss" in name or "azalea" in name:
        return (0.20, 0.48, 0.16, 1.0)
    if any(token in name for token in ("log", "wood", "stem", "hyphae")):
        return (0.38, 0.25, 0.12, 1.0)
    if any(token in name for token in ("stone", "cobble", "andesite", "diorite", "granite", "deepslate", "tuff", "ore")):
        return (0.43, 0.44, 0.45, 1.0)
    if "sand" in name:
        return (0.78, 0.71, 0.46, 1.0)
    if any(token in name for token in ("flower", "tulip", "poppy")):
        return (0.82, 0.30, 0.35, 1.0)
    if "water" in name:
        return (0.17, 0.43, 0.76, 0.58)
    if "snow" in name or "ice" in name:
        return (0.86, 0.92, 0.96, 1.0)
    return (0.56, 0.48, 0.34, 1.0)


def apply_structure_placements(project: ProjectDocument, terrain) -> StructurePlacementResult:
    palette = dict(PALETTE)
    assets = {asset.id: asset for asset in project.structure_assets}
    parsed: dict[str, ParsedSchematic] = {}
    blocks_by_y: dict[int, dict[int, int]] = {}
    issues: list[dict] = []
    summaries: list[dict] = []
    placed_blocks = 0
    clipped_blocks = 0
    missing_assets: set[str] = set()

    for placement in project.structure_placements:
        asset_model = assets.get(placement.asset_id)
        if asset_model is None:
            missing_assets.add(placement.asset_id)
            continue
        schematic = parsed.get(asset_model.id)
        if schematic is None:
            schematic = _asset_from_model(asset_model)
            parsed[asset_model.id] = schematic
        anchor_x = int(asset_model.anchor_x)
        anchor_y = int(asset_model.anchor_y)
        anchor_z = int(asset_model.anchor_z)
        ground_x = int(round(placement.x))
        ground_z = int(round(placement.z))
        if not (0 <= ground_x < project.config.width and 0 <= ground_z < project.config.length):
            continue
        base_y = int(terrain.height[ground_z, ground_x]) + 1 - int(placement.sink)
        instance_count = 0
        for x, y, z, state in schematic.blocks:
            dx = x - anchor_x
            dz = z - anchor_z
            if placement.mirror:
                dx = -dx
            rx, rz = _rotate_position(dx, dz, int(placement.rotation))
            world_x = ground_x + rx
            world_z = ground_z + rz
            world_y = base_y + (y - anchor_y)
            if not (0 <= world_x < project.config.width and 0 <= world_z < project.config.length and 1 <= world_y < project.config.schematic_height):
                clipped_blocks += 1
                continue
            rotated_state = _rotate_state(state, int(placement.rotation), bool(placement.mirror))
            block_id = palette.get(rotated_state)
            if block_id is None:
                block_id = len(palette)
                if block_id >= 128:
                    raise ValueError("Las estructuras usan más de 118 estados de bloque adicionales. Reduce la variedad de schematics para mantener la exportación streaming.")
                palette[rotated_state] = block_id
            flat = world_z * project.config.width + world_x
            blocks_by_y.setdefault(world_y, {})[flat] = block_id
            instance_count += 1
        placed_blocks += instance_count

    if missing_assets:
        issues.append({"severity": "warning", "code": "structure_asset_missing", "message": f"Se omitieron instancias de {len(missing_assets)} assets inexistentes."})
    if clipped_blocks:
        issues.append({"severity": "warning", "code": "structure_blocks_clipped", "message": f"Se recortaron {clipped_blocks} bloques estructurales fuera del mapa o de la altura exportable."})
    for collection in project.structure_collections:
        count = sum(1 for item in project.structure_placements if item.collection_id == collection.id)
        summaries.append({"id": collection.id, "label": collection.label, "category": collection.category, "instances": count})
    return StructurePlacementResult(palette, blocks_by_y, issues, summaries, placed_blocks)
