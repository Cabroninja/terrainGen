from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np

from app.core.models import ProjectDocument
from app.core.rle import encode_rle_u8
from app.exporters import write_preview_images, write_schematic, write_terrain_3d_data
from app.terrain import compile_project


def disk(array: np.ndarray, x: int, z: int, radius: int, value: int) -> None:
    zz, xx = np.ogrid[:array.shape[0], :array.shape[1]]
    array[(xx - x) ** 2 + (zz - z) ** 2 <= radius**2] = value


def main() -> None:
    width = length = 128
    shape = (length, width)
    playable = np.zeros(shape, dtype=np.uint8)
    playable[18:-18, 18:-18] = 255
    regions = np.ones(shape, dtype=np.uint8)
    regions[:, width // 2:] = 2
    regions[length // 2:, :width // 2] = 3
    regions[length // 2:, width // 2:] = 4
    roads = np.zeros(shape, dtype=np.uint8)
    roads[:, width // 2 - 3:width // 2 + 4] = 1
    roads[length // 2 - 3:length // 2 + 4, :] = 1
    roads[28:31, 24:104] = 2
    roads[96:99, 24:104] = 2
    height_base = np.full(shape, 118, dtype=np.uint8)
    zz, xx = np.indices(shape)
    height_base = np.clip(height_base + ((xx - 64) ** 2 + (zz - 64) ** 2) ** 0.5 * 0.35, 0, 255).astype(np.uint8)
    height_modifier = np.full(shape, 128, dtype=np.uint8)
    disk(height_modifier, 28, 35, 22, 175)
    disk(height_modifier, 101, 91, 25, 180)
    water = np.zeros(shape, dtype=np.uint8)
    disk(water, 28, 80, 8, 255)
    reserved = np.zeros(shape, dtype=np.uint8)
    disk(reserved, 92, 29, 12, 255)
    materials = np.zeros(shape, dtype=np.uint8)
    exclusion = np.zeros(shape, dtype=np.uint8)
    layers = {
        "playable": playable,
        "regions": regions,
        "roads": roads,
        "height_base": height_base,
        "height_modifier": height_modifier,
        "water": water,
        "reserved": reserved,
        "materials": materials,
        "exclusion": exclusion,
    }
    payload = {
        "format": "jkr-terrain-project",
        "version": 2,
        "config": {
            "name": "demo_albion_128",
            "width": width,
            "length": length,
            "schematic_height": 128,
            "min_height": 16,
            "max_height": 92,
            "sea_level": 34,
            "height_modifier_range": 24,
            "road_fit_width": 0,
            "reserved_fit_width": 0,
            "shore_width": 5,
            "max_walk_slope": 1.75,
            "surface_depth": 4,
            "data_version": 4189,
            "seed": 123456,
            "mountain_border_enabled": True,
            "mountain_outer_width": 18,
            "mountain_inner_transition": 12,
            "mountain_height": 30,
            "mountain_irregularity": 45,
            "mountain_roughness": 35,
            "mountain_exit_width": 12,
            "mountain_exit_transition": 26,
            "max_voxels": 750000000
        },
        "layers": {name: {"encoding": "rle-u8", "data": encode_rle_u8(array)} for name, array in layers.items()},
        "markers": [
            {"id": "spawn", "type": "spawn", "x": 64, "z": 64, "label": "Centro", "radius": 10},
            {"id": "north", "type": "exit", "x": 64, "z": 0, "label": "Salida norte", "radius": 8},
            {"id": "east", "type": "exit", "x": 127, "z": 64, "label": "Salida este", "radius": 8},
            {"id": "south", "type": "exit", "x": 64, "z": 127, "label": "Salida sur", "radius": 8},
            {"id": "west", "type": "exit", "x": 0, "z": 64, "label": "Salida oeste", "radius": 8},
            {"id": "poi1", "type": "poi", "x": 92, "z": 29, "label": "Campamento", "radius": 12}
        ]
    }
    root = ROOT
    project_path = root / "sample" / "demo_albion_128.jkrterrain.json"
    project_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    project = ProjectDocument.model_validate(payload)
    terrain = compile_project(project)
    write_preview_images(root / "sample", project.config, terrain)
    write_terrain_3d_data(root / "sample", project.config, terrain)
    write_schematic(root / "sample" / "demo_albion_128.schem", project.config, terrain)
    (root / "sample" / "demo_albion_128_validation.json").write_text(json.dumps(terrain.validation, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
