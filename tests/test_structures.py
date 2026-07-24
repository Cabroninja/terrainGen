from __future__ import annotations

import base64
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

from app.core.models import ProjectDocument
from app.exporters.schematic import build_block_data
from app.exporters.sponge import write_sponge_v3
from app.main import app
from app.structures import parse_schematic_bytes
from app.terrain.compiler import compile_project
from tests.helpers import project_payload


def tiny_tree_bytes(tmp_path: Path) -> bytes:
    width = height = length = 3
    data = np.zeros((height, length, width), dtype=np.uint8)
    data[0, 1, 1] = 1
    data[1, 1, 1] = 1
    data[2, :, :] = 2
    path = tmp_path / "tiny_tree.schem"
    write_sponge_v3(
        path,
        width=width,
        height=height,
        length=length,
        palette={"minecraft:air": 0, "minecraft:oak_log[axis=y]": 1, "minecraft:oak_leaves[persistent=true]": 2},
        block_data=data.ravel(order="C"),
        data_version=4189,
        name="tiny_tree",
    )
    return path.read_bytes()


def structure_project(tmp_path: Path) -> ProjectDocument:
    raw = tiny_tree_bytes(tmp_path)
    payload = project_payload(width=64, length=64, height=96)
    payload["structure_assets"] = [{
        "id": "asset_tree",
        "label": "Árbol pequeño",
        "category": "tree",
        "filename": "tiny_tree.schem",
        "width": 3,
        "height": 3,
        "length": 3,
        "anchor_x": 1,
        "anchor_y": 0,
        "anchor_z": 1,
        "block_count": 11,
        "palette_count": 3,
        "content_b64": base64.b64encode(raw).decode("ascii"),
    }]
    payload["structure_collections"] = [{
        "id": "forest",
        "label": "Bosque",
        "category": "tree",
        "members": [{"asset_id": "asset_tree", "weight": 100}],
    }]
    payload["structure_placements"] = [{
        "id": "tree_1",
        "collection_id": "forest",
        "asset_id": "asset_tree",
        "x": 20,
        "z": 22,
        "rotation": 90,
        "mirror": True,
        "sink": 1,
    }]
    return ProjectDocument.model_validate(payload)


def test_sponge_schematic_can_be_imported(tmp_path: Path):
    parsed = parse_schematic_bytes(tiny_tree_bytes(tmp_path))
    assert (parsed.width, parsed.height, parsed.length) == (3, 3, 3)
    assert parsed.anchor_x == 1
    assert parsed.anchor_y == 0
    assert parsed.block_count == 11
    assert any(state.startswith("minecraft:oak_log") for *_, state in parsed.blocks)


def test_import_api_returns_embeddable_asset(tmp_path: Path):
    raw = tiny_tree_bytes(tmp_path)
    client = TestClient(app)
    response = client.post("/api/structures/import", files={"file": ("tiny_tree.schem", raw, "application/octet-stream")})
    assert response.status_code == 200
    payload = response.json()
    assert payload["block_count"] == 11
    assert payload["anchor_y"] == 0
    assert base64.b64decode(payload["content_b64"]) == raw


def test_structure_placement_is_added_to_export_blocks(tmp_path: Path):
    project = structure_project(tmp_path)
    terrain = compile_project(project)
    assert terrain.validation["structures"]["instance_count"] == 1
    assert terrain.validation["structures"]["placed_blocks"] == 11
    log_id = terrain.block_palette["minecraft:oak_log[axis=y]"]
    blocks = build_block_data(project.config, terrain).reshape((project.config.schematic_height, 64, 64))
    ground = int(terrain.height[22, 20])
    assert blocks[ground, 22, 20] == log_id
    assert blocks[ground + 1, 22, 20] == log_id


def test_voxel_chunk_contains_sparse_structure_blocks(tmp_path: Path):
    from app.exporters.voxel import read_voxel_chunk, write_voxel_source

    project = structure_project(tmp_path)
    terrain = compile_project(project)
    output = tmp_path / "compiled"
    output.mkdir()
    write_voxel_source(output, project.config, terrain, job_id="job")
    chunk = read_voxel_chunk(output, 1, 1)
    assert chunk["structure_blocks"]
    assert any(block[0] == 20 and block[2] == 22 for block in chunk["structure_blocks"])
