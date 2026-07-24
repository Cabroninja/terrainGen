import numpy as np

from app.core.models import ProjectDocument
from app.core.rle import encode_rle_u8
from app.terrain.compiler import compile_project
from tests.helpers import project_payload


def _gradient_payload():
    payload = project_payload(width=64, length=64, height=128)
    # La altura aumenta de izquierda a derecha para comprobar que un trazo
    # dibujado desde abajo hacia arriba se invierte automáticamente.
    row = np.linspace(95, 185, 64, dtype=np.uint8)
    base = np.repeat(row[np.newaxis, :], 64, axis=0)
    payload["layers"]["height_base"]["data"] = encode_rle_u8(base)
    payload["water_courses"] = [{
        "id": "rio_libre",
        "label": "Río libre",
        "points": [{"x": 8, "z": 32}, {"x": 20, "z": 29}, {"x": 36, "z": 34}, {"x": 56, "z": 32}],
        "width": 7,
        "depth": 4,
        "shore_width": 6,
        "shore_profile": "natural",
        "road_policy": "protect",
        "smoothing": 60,
        "exit_enabled": False,
    }]
    return payload, base


def test_old_projects_without_water_courses_remain_compatible():
    project = ProjectDocument.model_validate(project_payload())
    assert project.water_courses == []
    assert project.config.water_depth == 3
    assert project.config.water_shore_profile == "natural"
    assert project.config.water_road_policy == "protect"


def test_freehand_river_follows_relief_and_reverses_low_to_high_stroke():
    payload, _ = _gradient_payload()
    terrain = compile_project(ProjectDocument.model_validate(payload))
    summary = terrain.validation["water_system"]["items"][0]
    assert summary["flow_reversed"] is True
    assert summary["start_surface"] > summary["end_surface"]
    assert summary["water_cells"] > 0

    # El eje completo debe contener agua y tener un nivel variable, no un plano global.
    center_surfaces = terrain.water_surface[32, 8:57]
    wet = center_surfaces >= 0
    assert wet.sum() > 35
    assert int(center_surfaces[wet].max()) > int(center_surfaces[wet].min())
    assert np.all(terrain.height[32, 8:57][wet] <= center_surfaces[wet] - 3)


def test_river_never_changes_terrain_outside_channel_plus_shore():
    payload, _ = _gradient_payload()
    with_river = compile_project(ProjectDocument.model_validate(payload))
    payload["water_courses"] = []
    without_river = compile_project(ProjectDocument.model_validate(payload))

    # Centro Z=32, medio ancho 3.5 y orilla 6: Z=18 y Z=46 están muy fuera.
    assert np.array_equal(with_river.height[18], without_river.height[18])
    assert np.array_equal(with_river.height[46], without_river.height[46])
    assert not np.any(with_river.water_mask[18])
    assert not np.any(with_river.water_mask[46])


def _road_crossing_payload(policy: str):
    payload = project_payload(width=64, length=64, height=128)
    roads = np.zeros((64, 64), dtype=np.uint8)
    roads[:, 30:35] = 1
    payload["layers"]["roads"]["data"] = encode_rle_u8(roads)
    payload["water_courses"] = [{
        "id": f"cruce_{policy}",
        "label": "Cruce",
        "points": [{"x": 8, "z": 32}, {"x": 56, "z": 32}],
        "width": 7,
        "depth": 3,
        "shore_width": 4,
        "shore_profile": "natural",
        "road_policy": policy,
        "smoothing": 40,
        "exit_enabled": False,
    }]
    return payload


def test_protect_policy_keeps_road_dry_and_unchanged():
    terrain = compile_project(ProjectDocument.model_validate(_road_crossing_payload("protect")))
    assert terrain.water_mask[32, 32] == 0
    assert terrain.road_mask[32, 32] == 1
    assert terrain.material[32, 32] == 6
    assert terrain.walkable[32, 32] == 1


def test_ford_policy_preserves_road_surface_under_one_block_of_water():
    terrain = compile_project(ProjectDocument.model_validate(_road_crossing_payload("ford")))
    assert terrain.water_mask[32, 32] == 1
    assert terrain.road_mask[32, 32] == 1
    assert terrain.water_surface[32, 32] == terrain.height[32, 32] + 1
    assert terrain.material[32, 32] == 6
    assert terrain.walkable[32, 32] == 1


def test_cut_policy_removes_road_where_river_has_priority():
    terrain = compile_project(ProjectDocument.model_validate(_road_crossing_payload("cut")))
    assert terrain.water_mask[32, 32] == 1
    assert terrain.road_mask[32, 32] == 0
    assert terrain.material[32, 32] == 7
    assert terrain.walkable[32, 32] == 0


def test_river_exit_reaches_boundary_and_opens_mountain_channel():
    payload = project_payload(width=64, length=64, height=128)
    playable = np.zeros((64, 64), dtype=np.uint8)
    playable[12:-12, 12:-12] = 255
    payload["layers"]["playable"]["data"] = encode_rle_u8(playable)
    payload["config"].update({
        "mountain_border_enabled": True,
        "mountain_outer_width": 12,
        "mountain_inner_transition": 10,
        "mountain_height": 24,
        "mountain_irregularity": 0,
        "mountain_roughness": 0,
    })
    payload["markers"] = [{"id": "salida_vial", "type": "exit", "x": 12, "z": 32, "label": "Oeste", "radius": 6}]
    payload["water_courses"] = [{
        "id": "rio_salida",
        "label": "Río de salida",
        "points": [{"x": 42, "z": 34}, {"x": 24, "z": 33}, {"x": 14, "z": 32}],
        "width": 7,
        "depth": 3,
        "shore_width": 5,
        "shore_profile": "natural",
        "road_policy": "protect",
        "smoothing": 50,
        "exit_enabled": True,
    }]
    terrain = compile_project(ProjectDocument.model_validate(payload))
    boundary = terrain.water_mask[:, 0] > 0
    assert np.any(boundary)
    assert np.any(terrain.water_exit_mask[:, 0] > 0)
    assert np.any(terrain.playable_mask[:, 0] > 0)
    assert np.all(terrain.water_surface[:, 0][boundary] >= 0)
    assert terrain.validation["water_system"]["exit_count"] == 1


def test_painted_mass_uses_configured_depth_shore_and_road_policy():
    payload = project_payload(width=64, length=64, height=128)
    water = np.zeros((64, 64), dtype=np.uint8)
    water[26:38, 26:38] = 255
    roads = np.zeros((64, 64), dtype=np.uint8)
    roads[:, 31:34] = 1
    payload["layers"]["water"]["data"] = encode_rle_u8(water)
    payload["layers"]["roads"]["data"] = encode_rle_u8(roads)
    payload["config"].update({
        "water_depth": 6,
        "shore_width": 8,
        "water_shore_profile": "smooth",
        "water_road_policy": "protect",
    })
    terrain = compile_project(ProjectDocument.model_validate(payload))
    assert terrain.water_mask[30, 28] == 1
    assert terrain.height[30, 28] <= payload["config"]["sea_level"] - 6
    assert terrain.water_mask[30, 32] == 0
    assert terrain.road_mask[30, 32] == 1
    assert terrain.height[30, 20] < terrain.height[10, 20]
    assert terrain.height[10, 10] == terrain.height[10, 20]
