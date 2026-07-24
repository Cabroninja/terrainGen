import numpy as np

from app.core.models import ProjectDocument
from app.core.rle import encode_rle_u8
from app.terrain.compiler import compile_project
from tests.helpers import project_payload


def test_roads_and_reserved_zones_do_not_modify_height():
    payload = project_payload()
    width = payload["config"]["width"]
    length = payload["config"]["length"]
    road = np.zeros((length, width), dtype=np.uint8)
    road[:, width // 2 - 2: width // 2 + 3] = 1
    reserved = np.zeros((length, width), dtype=np.uint8)
    reserved[12:42, 12:42] = 255
    base = np.full((length, width), 110, dtype=np.uint8)
    base[length // 2:, :] = 200
    payload["config"]["road_fit_width"] = 128
    payload["config"]["reserved_fit_width"] = 128
    payload["layers"]["roads"]["data"] = encode_rle_u8(road)
    payload["layers"]["reserved"]["data"] = encode_rle_u8(reserved)
    payload["layers"]["height_base"]["data"] = encode_rle_u8(base)
    project = ProjectDocument.model_validate(payload)
    terrain = compile_project(project)
    expected = payload["config"]["min_height"] + base.astype(np.float32) / 255.0 * (
        payload["config"]["max_height"] - payload["config"]["min_height"]
    )
    assert len(terrain.validation["detected_exits"]) >= 2
    assert np.array_equal(terrain.height, np.rint(expected).astype(np.int16))
    assert terrain.height.shape == (length, width)


def test_painted_water_creates_water_material():
    payload = project_payload()
    width = payload["config"]["width"]
    length = payload["config"]["length"]
    water = np.zeros((length, width), dtype=np.uint8)
    water[20:40, 20:40] = 255
    payload["layers"]["water"]["data"] = encode_rle_u8(water)
    terrain = compile_project(ProjectDocument.model_validate(payload))
    assert int((terrain.material == 7).sum()) == 400


def test_mountain_border_raises_ring_and_carves_exit_corridor():
    payload = project_payload()
    width = payload["config"]["width"]
    length = payload["config"]["length"]
    playable = np.zeros((length, width), dtype=np.uint8)
    playable[12:-12, 12:-12] = 255
    payload["layers"]["playable"]["data"] = encode_rle_u8(playable)
    payload["config"].update({
        "mountain_border_enabled": True,
        "mountain_outer_width": 12,
        "mountain_inner_transition": 8,
        "mountain_height": 22,
        "mountain_irregularity": 0,
        "mountain_roughness": 0,
        "mountain_exit_width": 10,
        "mountain_exit_transition": 18,
    })
    payload["markers"] = [{"id": "north", "type": "exit", "x": width // 2, "z": 0, "label": "Norte", "radius": 8}]
    terrain = compile_project(ProjectDocument.model_validate(payload))
    center_height = int(terrain.height[length // 2, width // 2])
    mountain_height = int(terrain.height[6, width // 2 - 12])
    corridor_height = int(terrain.height[6, width // 2])
    assert mountain_height >= center_height + 15
    assert corridor_height <= mountain_height - 12
    assert terrain.validation["mountain_border"]["enabled"] is True
    assert len(terrain.validation["resolved_mountain_exits"]) == 1
    assert int(terrain.exit_corridor_mask.sum()) > 0


def test_mountain_border_is_reproducible_and_requires_margin():
    payload = project_payload()
    payload["config"]["mountain_border_enabled"] = True
    project = ProjectDocument.model_validate(payload)
    first = compile_project(project)
    second = compile_project(project)
    assert np.array_equal(first.height, second.height)
    assert any(issue["code"] == "mountain_no_margin" for issue in first.validation["issues"])
    assert first.validation["status"] == "error"


def test_mountain_border_never_spreads_a_central_plateau_outside_its_mask():
    payload = project_payload(width=128, length=128, height=160)
    width = payload["config"]["width"]
    length = payload["config"]["length"]

    playable = np.zeros((length, width), dtype=np.uint8)
    playable[12:-12, 12:-12] = 255
    payload["layers"]["playable"]["data"] = encode_rle_u8(playable)

    base = np.full((length, width), 96, dtype=np.uint8)
    zz, xx = np.ogrid[:length, :width]
    center_x = width // 2
    center_z = length // 2
    plateau = (xx - center_x) ** 2 + (zz - center_z) ** 2 <= 12 ** 2
    base[plateau] = 235
    payload["layers"]["height_base"]["data"] = encode_rle_u8(base)

    payload["config"].update({
        "min_height": 16,
        "max_height": 120,
        "mountain_border_enabled": True,
        "mountain_outer_width": 18,
        "mountain_inner_transition": 14,
        "mountain_height": 30,
        "mountain_irregularity": 0,
        "mountain_roughness": 0,
    })

    terrain = compile_project(ProjectDocument.model_validate(payload))
    original = payload["config"]["min_height"] + base.astype(np.float32) / 255.0 * (
        payload["config"]["max_height"] - payload["config"]["min_height"]
    )
    expected = np.rint(original).astype(np.int16)

    unaffected = terrain.mountain_mask <= 1e-6
    assert np.any(unaffected)
    assert np.array_equal(terrain.height[unaffected], expected[unaffected])

    # Comprueba específicamente el anillo de suelo junto a una meseta dura.
    ring = ((xx - center_x) ** 2 + (zz - center_z) ** 2 >= 15 ** 2) & (
        (xx - center_x) ** 2 + (zz - center_z) ** 2 <= 28 ** 2
    )
    assert np.all(unaffected[ring])
    assert np.array_equal(terrain.height[ring], expected[ring])


def test_plateau_near_mountain_transition_never_raises_neighbouring_grass():
    """A hard plateau may overlap the mountain transition without bleeding outward."""
    payload = project_payload(width=128, length=128, height=160)
    width = payload["config"]["width"]
    length = payload["config"]["length"]

    playable = np.zeros((length, width), dtype=np.uint8)
    playable[10:-10, 10:-10] = 255
    payload["layers"]["playable"]["data"] = encode_rle_u8(playable)
    payload["config"].update({
        "min_height": 16,
        "max_height": 120,
        "mountain_border_enabled": True,
        "mountain_outer_width": 18,
        "mountain_inner_transition": 32,
        "mountain_height": 30,
        "mountain_irregularity": 0,
        "mountain_roughness": 0,
    })

    flat_base = np.full((length, width), 128, dtype=np.uint8)
    payload["layers"]["height_base"]["data"] = encode_rle_u8(flat_base)
    without_plateau = compile_project(ProjectDocument.model_validate(payload))

    zz, xx = np.ogrid[:length, :width]
    center_x = width // 2
    center_z = 28  # Dentro de la transición interior de la cordillera.
    plateau_mask = (xx - center_x) ** 2 + (zz - center_z) ** 2 <= 12 ** 2
    plateau_base = flat_base.copy()
    plateau_base[plateau_mask] = 235
    payload["layers"]["height_base"]["data"] = encode_rle_u8(plateau_base)
    with_plateau = compile_project(ProjectDocument.model_validate(payload))

    # El efecto de añadir la meseta queda estrictamente dentro de su huella.
    assert np.array_equal(
        with_plateau.height[~plateau_mask],
        without_plateau.height[~plateau_mask],
    )
    assert np.any(with_plateau.mountain_mask[plateau_mask] > 0)
