from pathlib import Path

from app.exporters.images import write_preview_images
from app.exporters.schematic import write_schematic
from app.terrain.compiler import compile_project
from tests.helpers import make_project


def test_images_and_schematic_are_written(tmp_path: Path):
    project = make_project(width=64, length=128, height=96)
    terrain = compile_project(project)
    files = write_preview_images(tmp_path, project.config, terrain)
    assert (tmp_path / files["preview"]).is_file()
    schematic = tmp_path / "map.schem"
    write_schematic(schematic, project.config, terrain)
    assert schematic.is_file()
    assert schematic.read_bytes()[:2] == b"\x1f\x8b"


def test_voxel_block_rules_match_schematic_data():
    from app.exporters.blocks import block_id_at_y
    from app.exporters.schematic import build_block_data

    project = make_project(width=64, length=64, height=96)
    terrain = compile_project(project)
    data = build_block_data(project.config, terrain).reshape(
        (project.config.schematic_height, project.config.length, project.config.width)
    )
    for z, x in [(0, 0), (7, 13), (32, 32), (63, 63)]:
        for y in [0, 1, 20, int(terrain.height[z, x]), project.config.sea_level, 95]:
            expected = block_id_at_y(
                y=y,
                surface_y=int(terrain.height[z, x]),
                material_code=int(terrain.material[z, x]),
                playable=bool(terrain.playable_mask[z, x]),
                water=bool(terrain.water_mask[z, x]),
                config=project.config,
            )
            assert int(data[y, z, x]) == expected


def test_variable_river_levels_match_schematic_blocks():
    import numpy as np

    from app.core.models import ProjectDocument
    from app.core.rle import encode_rle_u8
    from app.exporters.blocks import PALETTE
    from app.exporters.schematic import build_block_data
    from tests.helpers import project_payload

    payload = project_payload(width=64, length=64, height=128)
    base = np.repeat(np.linspace(180, 100, 64, dtype=np.uint8)[:, np.newaxis], 64, axis=1)
    payload["layers"]["height_base"]["data"] = encode_rle_u8(base)
    payload["water_courses"] = [{
        "id": "river_export",
        "points": [{"x": 32, "z": 8}, {"x": 30, "z": 28}, {"x": 34, "z": 48}, {"x": 32, "z": 56}],
        "width": 7,
        "depth": 4,
        "shore_width": 5,
        "smoothing": 50,
    }]
    project = ProjectDocument.model_validate(payload)
    terrain = compile_project(project)
    blocks = build_block_data(project.config, terrain).reshape((project.config.schematic_height, 64, 64))
    wet_cells = np.argwhere(terrain.water_mask > 0)
    assert wet_cells.size
    for z, x in wet_cells[::max(1, len(wet_cells) // 12)]:
        surface = int(terrain.water_surface[z, x])
        floor = int(terrain.height[z, x])
        assert blocks[surface, z, x] == PALETTE["minecraft:water[level=0]"]
        assert blocks[floor, z, x] != PALETTE["minecraft:water[level=0]"]
