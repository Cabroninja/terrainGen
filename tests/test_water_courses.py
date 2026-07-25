import numpy as np

from app.core.models import ProjectDocument
from app.core.rle import encode_rle_u8
from app.terrain.compiler import compile_project
from tests.helpers import project_payload


def _gradient_payload(style: str = "natural"):
    payload = project_payload(width=64, length=64, height=128)
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
        "river_style": style,
        "smoothing": 60,
        "exit_enabled": False,
    }]
    return payload, base


def _cliff_payload(style: str = "natural"):
    payload = project_payload(width=96, length=64, height=192)
    base = np.full((64, 96), 70, dtype=np.uint8)
    base[:, :40] = 120
    payload["layers"]["height_base"]["data"] = encode_rle_u8(base)
    payload["water_courses"] = [{
        "id": "rio_cascada",
        "label": "Río automático",
        "points": [{"x": 8, "z": 32}, {"x": 88, "z": 32}],
        "width": 7,
        "depth": 3,
        "shore_width": 5,
        "shore_profile": "natural",
        "road_policy": "protect",
        "river_style": style,
        "smoothing": 0,
        "exit_enabled": False,
    }]
    return payload


def test_old_projects_without_water_courses_remain_compatible():
    project = ProjectDocument.model_validate(project_payload())
    assert project.water_courses == []
    assert project.config.water_depth == 3
    assert project.config.water_shore_profile == "natural"
    assert project.config.water_road_policy == "protect"


def test_old_river_fields_are_accepted_but_automatic_style_defaults_to_natural():
    payload, _ = _gradient_payload()
    course = payload["water_courses"][0]
    course.pop("river_style")
    course.update({
        "relief_mode": "follow",
        "cascade_containment": True,
        "cascade_threshold": 2,
        "downhill_slope_ratio": 12,
    })
    project = ProjectDocument.model_validate(payload)
    assert project.water_courses[0].river_style == "natural"
    terrain = compile_project(project)
    summary = terrain.validation["water_system"]["items"][0]
    assert summary["river_style"] == "natural"
    assert "relief_mode" not in summary
    assert "downhill_slope_ratio" not in summary


def test_automatic_river_selects_the_downhill_direction_even_if_drawn_backwards():
    payload, _ = _gradient_payload()
    terrain = compile_project(ProjectDocument.model_validate(payload))
    summary = terrain.validation["water_system"]["items"][0]
    assert summary["flow_reversed"] is True
    assert summary["start_surface"] >= summary["end_surface"]
    assert summary["water_cells"] > 0


def test_automatic_cliff_becomes_a_vertical_waterfall_not_a_diagonal_ramp():
    terrain = compile_project(ProjectDocument.model_validate(_cliff_payload()))
    summary = terrain.validation["water_system"]["items"][0]
    assert summary["cascades_detected"] >= 1
    assert summary["cascades_contained"] >= 1
    assert summary["plunge_pool_cells"] > 0
    assert int(terrain.water_fall_mask.sum()) > 0

    center = terrain.water_surface[32, 8:89]
    wet = terrain.water_mask[32, 8:89] > 0
    ordinary = center[wet & (terrain.water_fall_mask[32, 8:89] == 0)]
    # The plateau edge must resolve into upper/lower reaches. It must not create
    # dozens of intermediate levels that look like a steep diagonal river.
    assert np.unique(ordinary).size <= 4
    assert max(summary["waterfall_heights"]) >= 4


def test_waterfall_alcove_blends_side_walls_instead_of_a_clean_cylindrical_shell():
    terrain = compile_project(ProjectDocument.model_validate(_cliff_payload()))
    local_height = terrain.height[22:44, 34:46]
    local_water = terrain.water_mask[22:44, 34:46] > 0
    dry = local_height[~local_water]
    # The side walls around the waterfall should contain intermediate rocky
    # heights. A perfectly cylindrical shell would leave most dry cells either
    # at the plateau top (120) or the lower plain (70).
    assert np.any((dry > 76) & (dry < 118))


def test_waterfall_column_uses_falling_water_and_normal_channel_keeps_bounded_depth():
    terrain = compile_project(ProjectDocument.model_validate(_cliff_payload()))
    wet = terrain.water_mask > 0
    ordinary = wet & (terrain.water_fall_mask == 0)
    depths = terrain.water_surface[ordinary] - terrain.height[ordinary]
    assert depths.size
    assert int(depths.max()) <= 4
    falling = terrain.water_fall_mask > 0
    assert np.all(terrain.water_surface[falling] > terrain.height[falling] + 3)


def test_automatic_profile_builds_missing_bed_and_dry_banks_on_low_ground():
    payload = project_payload(width=96, length=64, height=192)
    base = np.full((64, 96), 25, dtype=np.uint8)
    base[:, :40] = 110
    payload["layers"]["height_base"]["data"] = encode_rle_u8(base)
    payload["water_courses"] = [{
        "id": "rio_soporte",
        "label": "Río con soporte",
        "points": [{"x": 8, "z": 32}, {"x": 88, "z": 32}],
        "width": 7,
        "depth": 3,
        "shore_width": 6,
        "shore_profile": "natural",
        "road_policy": "protect",
        "river_style": "natural",
        "smoothing": 0,
        "exit_enabled": False,
    }]
    baseline_payload = project_payload(width=96, length=64, height=192)
    baseline_payload["layers"]["height_base"]["data"] = encode_rle_u8(base)
    baseline = compile_project(ProjectDocument.model_validate(baseline_payload))
    terrain = compile_project(ProjectDocument.model_validate(payload))

    wet_low = (terrain.water_mask[32, 45:80] > 0) & (terrain.water_fall_mask[32, 45:80] == 0)
    assert wet_low.any()
    xs = np.flatnonzero(wet_low) + 45
    # The automatic planner is allowed to lower the receiving reach instead of
    # building a tall embankment, but its immediate dry banks must contain it.
    assert np.all(terrain.height[32, xs] <= baseline.height[32, xs])
    for x in xs[:: max(1, len(xs) // 8)]:
        surface = int(terrain.water_surface[32, x])
        dry_z = next((z for z in range(31, 20, -1) if terrain.water_mask[z, x] == 0), None)
        assert dry_z is not None
        assert int(terrain.height[dry_z, x]) >= surface - 1


def test_river_never_changes_terrain_outside_channel_plus_shore_and_waterfall_margin():
    payload, _ = _gradient_payload()
    with_river = compile_project(ProjectDocument.model_validate(payload))
    payload["water_courses"] = []
    without_river = compile_project(ProjectDocument.model_validate(payload))
    assert np.array_equal(with_river.height[14], without_river.height[14])
    assert np.array_equal(with_river.height[50], without_river.height[50])
    assert not np.any(with_river.water_mask[14])
    assert not np.any(with_river.water_mask[50])


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
        "river_style": "natural",
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
        "river_style": "natural",
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


def test_styles_change_automatic_character_without_exposing_slope_controls():
    calm = compile_project(ProjectDocument.model_validate(_cliff_payload("calm")))
    natural = compile_project(ProjectDocument.model_validate(_cliff_payload("natural")))
    mountain = compile_project(ProjectDocument.model_validate(_cliff_payload("mountain")))
    calm_summary = calm.validation["water_system"]["items"][0]
    natural_summary = natural.validation["water_system"]["items"][0]
    mountain_summary = mountain.validation["water_system"]["items"][0]
    assert calm_summary["river_style"] == "calm"
    assert natural_summary["river_style"] == "natural"
    assert mountain_summary["river_style"] == "mountain"
    assert calm_summary["style_label"] == "Tranquilo"
    assert mountain_summary["style_label"] == "Montañoso"
    # All styles must solve the cliff as a waterfall rather than a steep ramp.
    assert calm_summary["cascades_detected"] >= 1
    assert natural_summary["cascades_detected"] >= 1
    assert mountain_summary["cascades_detected"] >= 1
