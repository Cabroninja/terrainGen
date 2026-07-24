from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.core.models import ProjectConfig

# The palette order is part of the exported Sponge schematic contract.
PALETTE: dict[str, int] = {
    "minecraft:air": 0,
    "minecraft:bedrock": 1,
    "minecraft:stone": 2,
    "minecraft:dirt": 3,
    "minecraft:grass_block": 4,
    "minecraft:sand": 5,
    "minecraft:snow_block": 6,
    "minecraft:gravel": 7,
    "minecraft:water[level=0]": 8,
    "minecraft:coarse_dirt": 9,
}

BLOCK_NAME_BY_ID = {value: key for key, value in PALETTE.items()}

# Compiled material code -> schematic top block.
TOP_BLOCK: dict[int, int] = {
    1: PALETTE["minecraft:grass_block"],
    2: PALETTE["minecraft:coarse_dirt"],
    3: PALETTE["minecraft:stone"],
    4: PALETTE["minecraft:sand"],
    5: PALETTE["minecraft:snow_block"],
    6: PALETTE["minecraft:gravel"],
    7: PALETTE["minecraft:sand"],
}

# Lightweight colors used by the browser voxel preview. They are deliberately
# representative rather than copied from Mojang textures.
BLOCK_COLORS: dict[int, tuple[float, float, float, float]] = {
    PALETTE["minecraft:air"]: (0.0, 0.0, 0.0, 0.0),
    PALETTE["minecraft:bedrock"]: (0.20, 0.20, 0.22, 1.0),
    PALETTE["minecraft:stone"]: (0.48, 0.49, 0.50, 1.0),
    PALETTE["minecraft:dirt"]: (0.43, 0.30, 0.19, 1.0),
    PALETTE["minecraft:grass_block"]: (0.34, 0.58, 0.27, 1.0),
    PALETTE["minecraft:sand"]: (0.82, 0.75, 0.50, 1.0),
    PALETTE["minecraft:snow_block"]: (0.93, 0.96, 0.98, 1.0),
    PALETTE["minecraft:gravel"]: (0.54, 0.53, 0.51, 1.0),
    PALETTE["minecraft:water[level=0]"]: (0.17, 0.43, 0.76, 0.58),
    PALETTE["minecraft:coarse_dirt"]: (0.48, 0.35, 0.22, 1.0),
}


def top_block_id(material_code: int, playable: bool) -> int:
    if not playable:
        return PALETTE["minecraft:stone"]
    return TOP_BLOCK.get(int(material_code), PALETTE["minecraft:grass_block"])


def block_id_at_y(
    *,
    y: int,
    surface_y: int,
    material_code: int,
    playable: bool,
    water: bool,
    config: ProjectConfig,
    water_surface_y: int | None = None,
) -> int:
    """Return the exact block id used by the schematic generator for one cell."""
    if y < 0 or y >= config.schematic_height:
        return PALETTE["minecraft:air"]
    if y == 0:
        return PALETTE["minecraft:bedrock"]
    if not playable:
        return PALETTE["minecraft:stone"] if y <= surface_y else PALETTE["minecraft:air"]
    resolved_water_surface = config.sea_level if water_surface_y is None else int(water_surface_y)
    if water and surface_y < y <= resolved_water_surface:
        return PALETTE["minecraft:water[level=0]"]
    if y > surface_y:
        return PALETTE["minecraft:air"]
    if y == surface_y:
        return top_block_id(material_code, True)
    if y >= max(1, surface_y - config.surface_depth):
        return PALETTE["minecraft:dirt"]
    return PALETTE["minecraft:stone"]


def visible_column_top(
    surface_y: int,
    water: bool,
    config: ProjectConfig,
    water_surface_y: int | None = None,
) -> int:
    resolved_water_surface = config.sea_level if water_surface_y is None else int(water_surface_y)
    if water and resolved_water_surface > surface_y:
        return resolved_water_surface
    return surface_y


def build_block_layer(config: ProjectConfig, terrain, y: int) -> np.ndarray:
    """Build one Y layer using the same rules for preview and export."""
    layer = np.zeros((config.length, config.width), dtype=np.uint8)
    surface = terrain.height.astype(np.int32)
    water = terrain.water_mask > 0
    water_surface = terrain.water_surface.astype(np.int32)
    playable = terrain.playable_mask > 0
    if y == 0:
        layer[:] = PALETTE["minecraft:bedrock"]
        return layer
    stone = playable & (y < np.maximum(1, surface - config.surface_depth))
    subsoil = playable & (y >= np.maximum(1, surface - config.surface_depth)) & (y < surface)
    top = playable & (y == surface)
    layer[stone] = PALETTE["minecraft:stone"]
    layer[subsoil] = PALETTE["minecraft:dirt"]
    if np.any(top):
        for material_code, block_index in TOP_BLOCK.items():
            layer[top & (terrain.material == material_code)] = block_index
    layer[water & (y > surface) & (y <= water_surface)] = PALETTE["minecraft:water[level=0]"]
    layer[(~playable) & (y <= surface)] = PALETTE["minecraft:stone"]
    structure_layer = getattr(terrain, "structure_blocks_by_y", {}).get(y)
    if structure_layer:
        flat = layer.ravel(order="C")
        for index, block_id in structure_layer.items():
            flat[int(index)] = int(block_id)
    return layer
