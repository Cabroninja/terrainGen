from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from app.core.models import ProjectConfig
from app.terrain.compiler import CompiledTerrain


def _sample_axis(size: int, maximum_points: int) -> np.ndarray:
    """Return monotonic source indices including both map edges."""
    if size <= maximum_points:
        return np.arange(size, dtype=np.int32)
    step = max(1, math.ceil((size - 1) / (maximum_points - 1)))
    indices = np.arange(0, size, step, dtype=np.int32)
    if indices[-1] != size - 1:
        indices = np.append(indices, size - 1)
    return indices


def write_terrain_3d_data(
    output_dir: Path,
    config: ProjectConfig,
    terrain: CompiledTerrain,
    maximum_points: int = 161,
) -> str:
    """Write a compact, browser-friendly sampled terrain dataset.

    The editable project and schematic keep their full resolution. Sampling only
    affects the interactive preview so maps up to 2048×2048 remain responsive in WebGL.
    """
    xs = _sample_axis(config.width, maximum_points)
    zs = _sample_axis(config.length, maximum_points)
    selection = np.ix_(zs, xs)

    payload = {
        "format": "jkr-terrain-preview-3d",
        "version": 2,
        "source_width": config.width,
        "source_length": config.length,
        "width": int(xs.size),
        "length": int(zs.size),
        "x_coordinates": xs.tolist(),
        "z_coordinates": zs.tolist(),
        "min_height": config.min_height,
        "max_height": config.max_height,
        "sea_level": config.sea_level,
        "height": terrain.height[selection].astype(np.int16).ravel().tolist(),
        "material": terrain.material[selection].astype(np.uint8).ravel().tolist(),
        "roads": terrain.road_mask[selection].astype(np.uint8).ravel().tolist(),
        "water": terrain.water_mask[selection].astype(np.uint8).ravel().tolist(),
        "water_surface": terrain.water_surface[selection].astype(np.int16).ravel().tolist(),
        "water_fall": terrain.water_fall_mask[selection].astype(np.uint8).ravel().tolist(),
        "reserved": terrain.reserved_mask[selection].astype(np.uint8).ravel().tolist(),
        "playable": terrain.playable_mask[selection].astype(np.uint8).ravel().tolist(),
        "mountain": np.clip(terrain.mountain_mask[selection] * 255.0, 0, 255).astype(np.uint8).ravel().tolist(),
        "exit_corridors": terrain.exit_corridor_mask[selection].astype(np.uint8).ravel().tolist(),
        "markers": terrain.markers,
    }
    filename = f"{config.name}_terrain3d.json"
    (output_dir / filename).write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    return filename
