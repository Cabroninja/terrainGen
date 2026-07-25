from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from app.core.models import ProjectConfig
from app.terrain.compiler import CompiledTerrain
from .blocks import BLOCK_COLORS, BLOCK_NAME_BY_ID, PALETTE, top_block_id
from app.structures.placement import block_color_for_state

VOXEL_DIR_NAME = ".voxel"
VOXEL_CHUNK_SIZE = 16


def write_voxel_source(
    output_dir: Path,
    config: ProjectConfig,
    terrain: CompiledTerrain,
    *,
    job_id: str,
) -> str:
    """Persist compact column data for on-demand, block-accurate chunk previews."""
    voxel_dir = output_dir / VOXEL_DIR_NAME
    voxel_dir.mkdir(parents=True, exist_ok=True)
    np.save(voxel_dir / "height.npy", terrain.height.astype(np.int16, copy=False), allow_pickle=False)
    np.save(voxel_dir / "material.npy", terrain.material.astype(np.uint8, copy=False), allow_pickle=False)
    np.save(voxel_dir / "playable.npy", terrain.playable_mask.astype(np.uint8, copy=False), allow_pickle=False)
    np.save(voxel_dir / "water.npy", terrain.water_mask.astype(np.uint8, copy=False), allow_pickle=False)
    np.save(voxel_dir / "water_surface.npy", terrain.water_surface.astype(np.int16, copy=False), allow_pickle=False)
    np.save(voxel_dir / "water_fall.npy", terrain.water_fall_mask.astype(np.uint8, copy=False), allow_pickle=False)
    structure_dir = voxel_dir / "structures"
    structure_dir.mkdir(parents=True, exist_ok=True)
    grouped: dict[tuple[int, int], list[list[int]]] = {}
    for y, layer in getattr(terrain, "structure_blocks_by_y", {}).items():
        for flat, block_id in layer.items():
            z, x = divmod(int(flat), config.width)
            grouped.setdefault((x // VOXEL_CHUNK_SIZE, z // VOXEL_CHUNK_SIZE), []).append([x, int(y), z, int(block_id)])
    for (chunk_x, chunk_z), blocks in grouped.items():
        (structure_dir / f"{chunk_x}_{chunk_z}.json").write_text(json.dumps(blocks, separators=(",", ":")), encoding="utf-8")

    dynamic_palette = getattr(terrain, "block_palette", PALETTE)
    palette_by_id = {index: state for state, index in dynamic_palette.items()}
    manifest = {
        "format": "jkr-voxel-preview",
        "version": 2,
        "source": "same-block-rules-as-schematic",
        "width": config.width,
        "length": config.length,
        "schematic_height": config.schematic_height,
        "min_height": config.min_height,
        "max_height": config.max_height,
        "sea_level": config.sea_level,
        "surface_depth": config.surface_depth,
        "chunk_size": VOXEL_CHUNK_SIZE,
        "chunks_x": (config.width + VOXEL_CHUNK_SIZE - 1) // VOXEL_CHUNK_SIZE,
        "chunks_z": (config.length + VOXEL_CHUNK_SIZE - 1) // VOXEL_CHUNK_SIZE,
        "chunk_url": f"/api/voxel/{job_id}/{{x}}/{{z}}",
        "palette": [
            {
                "id": block_id,
                "state": palette_by_id[block_id],
                "color": list(BLOCK_COLORS.get(block_id, block_color_for_state(palette_by_id[block_id]))),
            }
            for block_id in sorted(palette_by_id)
        ],
        "structures": {
            "instances": len(getattr(terrain, "structure_blocks_by_y", {})),
            "blocks": sum(len(layer) for layer in getattr(terrain, "structure_blocks_by_y", {}).values()),
        },
        "controls": {
            "default_render_distance": 4,
            "maximum_render_distance": 16,
            "default_cut_y": config.schematic_height - 1,
        },
    }
    filename = f"{config.name}_voxel3d.json"
    (output_dir / filename).write_text(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    return filename


def read_voxel_chunk(output_dir: Path, chunk_x: int, chunk_z: int) -> dict:
    manifest_files = list(output_dir.glob("*_voxel3d.json"))
    voxel_dir = output_dir / VOXEL_DIR_NAME
    if not manifest_files or not voxel_dir.is_dir():
        raise FileNotFoundError("La vista voxel no está disponible para esta compilación.")
    manifest = json.loads(manifest_files[0].read_text(encoding="utf-8"))
    chunk_size = int(manifest["chunk_size"])
    chunks_x = int(manifest["chunks_x"])
    chunks_z = int(manifest["chunks_z"])
    if chunk_x < 0 or chunk_z < 0 or chunk_x >= chunks_x or chunk_z >= chunks_z:
        raise IndexError("Chunk fuera del mapa.")

    height = np.load(voxel_dir / "height.npy", mmap_mode="r", allow_pickle=False)
    material = np.load(voxel_dir / "material.npy", mmap_mode="r", allow_pickle=False)
    playable = np.load(voxel_dir / "playable.npy", mmap_mode="r", allow_pickle=False)
    water = np.load(voxel_dir / "water.npy", mmap_mode="r", allow_pickle=False)
    water_surface_path = voxel_dir / "water_surface.npy"
    water_surface = np.load(water_surface_path, mmap_mode="r", allow_pickle=False) if water_surface_path.is_file() else None
    water_fall_path = voxel_dir / "water_fall.npy"
    water_fall = np.load(water_fall_path, mmap_mode="r", allow_pickle=False) if water_fall_path.is_file() else None

    width = int(manifest["width"])
    length = int(manifest["length"])
    core_x0 = chunk_x * chunk_size
    core_z0 = chunk_z * chunk_size
    core_x1 = min(width, core_x0 + chunk_size)
    core_z1 = min(length, core_z0 + chunk_size)

    # Include one-cell halo so the browser can generate exact exposed faces on
    # chunk borders without requiring neighbor chunks to be loaded first.
    x0 = max(0, core_x0 - 1)
    z0 = max(0, core_z0 - 1)
    x1 = min(width, core_x1 + 1)
    z1 = min(length, core_z1 + 1)
    hs = np.asarray(height[z0:z1, x0:x1], dtype=np.int16)
    ms = np.asarray(material[z0:z1, x0:x1], dtype=np.uint8)
    ps = np.asarray(playable[z0:z1, x0:x1], dtype=np.uint8)
    ws = np.asarray(water[z0:z1, x0:x1], dtype=np.uint8)
    if water_surface is None:
        wss = np.full(ws.shape, int(manifest["sea_level"]), dtype=np.int16)
        wss[ws == 0] = -1
    else:
        wss = np.asarray(water_surface[z0:z1, x0:x1], dtype=np.int16)
    wfs = np.zeros(ws.shape, dtype=np.uint8) if water_fall is None else np.asarray(water_fall[z0:z1, x0:x1], dtype=np.uint8)

    tops = np.empty_like(ms, dtype=np.uint8)
    for local_z in range(ms.shape[0]):
        for local_x in range(ms.shape[1]):
            tops[local_z, local_x] = top_block_id(int(ms[local_z, local_x]), bool(ps[local_z, local_x]))

    structure_blocks: list[list[int]] = []
    structure_dir = voxel_dir / "structures"
    if structure_dir.is_dir():
        for neighbor_z in range(max(0, chunk_z - 1), min(chunks_z - 1, chunk_z + 1) + 1):
            for neighbor_x in range(max(0, chunk_x - 1), min(chunks_x - 1, chunk_x + 1) + 1):
                path = structure_dir / f"{neighbor_x}_{neighbor_z}.json"
                if not path.is_file():
                    continue
                for block in json.loads(path.read_text(encoding="utf-8")):
                    bx, by, bz, block_id = map(int, block)
                    if x0 <= bx < x1 and z0 <= bz < z1:
                        structure_blocks.append([bx, by, bz, block_id])

    return {
        "format": "jkr-voxel-chunk",
        "version": 2,
        "chunk_x": chunk_x,
        "chunk_z": chunk_z,
        "core_x0": core_x0,
        "core_z0": core_z0,
        "core_width": core_x1 - core_x0,
        "core_length": core_z1 - core_z0,
        "x0": x0,
        "z0": z0,
        "width": x1 - x0,
        "length": z1 - z0,
        "height": hs.ravel(order="C").tolist(),
        "material": ms.ravel(order="C").tolist(),
        "top_block": tops.ravel(order="C").tolist(),
        "playable": ps.ravel(order="C").tolist(),
        "water": ws.ravel(order="C").tolist(),
        "water_surface": wss.ravel(order="C").tolist(),
        "water_fall": wfs.ravel(order="C").tolist(),
        "structure_blocks": structure_blocks,
    }
