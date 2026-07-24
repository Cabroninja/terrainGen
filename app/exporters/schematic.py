from __future__ import annotations

from pathlib import Path

import numpy as np

from app.core.models import ProjectConfig
from app.terrain.compiler import CompiledTerrain
from .blocks import PALETTE, build_block_layer
from .sponge import write_sponge_v3_streaming


def build_block_data(config: ProjectConfig, terrain: CompiledTerrain) -> np.ndarray:
    voxels = config.width * config.length * config.schematic_height
    if voxels > config.max_voxels:
        raise ValueError(
            f"El schematic tendría {voxels:,} bloques y supera el límite configurado de {config.max_voxels:,}. "
            "Reduce ancho, largo o altura."
        )
    data = np.zeros((config.schematic_height, config.length, config.width), dtype=np.uint8)
    for y in range(config.schematic_height):
        data[y] = build_block_layer(config, terrain, y)
    return data.ravel(order="C")


def _iter_block_layers(config: ProjectConfig, terrain: CompiledTerrain):
    for y in range(config.schematic_height):
        yield build_block_layer(config, terrain, y).ravel(order="C").tobytes()


def write_schematic(path: Path, config: ProjectConfig, terrain: CompiledTerrain) -> None:
    voxels = config.width * config.length * config.schematic_height
    if voxels > config.max_voxels:
        raise ValueError(
            f"El schematic tendría {voxels:,} bloques y supera el límite configurado de {config.max_voxels:,}. "
            "Reduce ancho, largo o altura."
        )
    write_sponge_v3_streaming(
        path,
        width=config.width,
        height=config.schematic_height,
        length=config.length,
        palette=getattr(terrain, "block_palette", PALETTE),
        block_data_length=voxels,
        block_layers=_iter_block_layers(config, terrain),
        data_version=config.data_version,
        name=config.name,
    )
