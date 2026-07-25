import numpy as np

from app.core.models import ProjectDocument
from app.core.rle import encode_rle_u8
from app.terrain.compiler import compile_project
from tests.helpers import project_payload


def _ramp_payload():
    payload = project_payload(width=64, length=64, height=128)
    base = np.full((64, 64), 100, dtype=np.uint8)
    base[:, 48:] = 150
    payload["layers"]["height_base"]["data"] = encode_rle_u8(base)
    payload["road_ramps"] = [{
        "id": "access_north",
        "label": "Acceso norte",
        "road_type": "primary",
        "points": [{"x": 8, "z": 32}, {"x": 56, "z": 32}],
        "width": 7,
        "shoulder_width": 5,
        "slope_ratio": 3,
        "start_landing": 4,
        "end_landing": 4,
    }]
    return payload, base


def test_explicit_road_ramp_builds_monotonic_center_and_paints_road():
    payload, _ = _ramp_payload()
    terrain = compile_project(ProjectDocument.model_validate(payload))
    center = terrain.height[32, 8:57]
    assert np.all(np.diff(center) >= 0)
    assert int(np.max(np.diff(center))) <= 1
    assert np.all(terrain.road_mask[32, 8:57] == 1)
    assert terrain.validation["road_ramps"]["count"] == 1
    assert terrain.validation["road_ramps"]["valid"] == 1


def test_road_ramp_never_changes_terrain_outside_center_plus_shoulder():
    payload, base = _ramp_payload()
    terrain = compile_project(ProjectDocument.model_validate(payload))
    expected = payload["config"]["min_height"] + base.astype(np.float32) / 255.0 * (
        payload["config"]["max_height"] - payload["config"]["min_height"]
    )
    expected = np.rint(expected).astype(np.int16)
    # The ramp is centered at Z=32 with outer radius 8.5. Z=20 is safely outside.
    assert np.array_equal(terrain.height[20], expected[20])
    assert np.array_equal(terrain.height[44], expected[44])


def test_too_short_ramp_is_reported_as_error():
    payload, _ = _ramp_payload()
    payload["road_ramps"][0]["points"] = [{"x": 40, "z": 32}, {"x": 52, "z": 32}]
    payload["road_ramps"][0]["slope_ratio"] = 4
    terrain = compile_project(ProjectDocument.model_validate(payload))
    assert terrain.validation["status"] == "error"
    assert any(issue["code"] == "road_ramp_too_short" for issue in terrain.validation["issues"])


def test_old_projects_without_ramps_remain_compatible():
    project = ProjectDocument.model_validate(project_payload())
    assert project.road_ramps == []


def test_smoothed_ramp_sides_expand_adaptively_but_respect_hard_limit():
    payload, base = _ramp_payload()
    payload["road_ramps"][0].update({
        "smooth_sides": True,
        "side_slope_ratio": 2,
        "max_side_width": 12,
        "side_roundness": 65,
        "follow_terrain": True,
    })
    terrain = compile_project(ProjectDocument.model_validate(payload))
    expected = payload["config"]["min_height"] + base.astype(np.float32) / 255.0 * (
        payload["config"]["max_height"] - payload["config"]["min_height"]
    )
    expected = np.rint(expected).astype(np.int16)
    # Z=25 is outside the old 5-block shoulder but inside the adaptive side.
    assert np.any(terrain.height[25] != expected[25])
    # Half width 3.5 + maximum side width 12 cannot reach Z=15 from center Z=32.
    assert np.array_equal(terrain.height[15], expected[15])
    assert np.array_equal(terrain.height[49], expected[49])


def test_disabling_side_smoothing_preserves_fixed_legacy_shoulder():
    payload, base = _ramp_payload()
    payload["road_ramps"][0].update({
        "smooth_sides": False,
        "side_slope_ratio": 8,
        "max_side_width": 64,
        "side_roundness": 100,
    })
    terrain = compile_project(ProjectDocument.model_validate(payload))
    expected = payload["config"]["min_height"] + base.astype(np.float32) / 255.0 * (
        payload["config"]["max_height"] - payload["config"]["min_height"]
    )
    expected = np.rint(expected).astype(np.int16)
    assert np.array_equal(terrain.height[20], expected[20])
    assert np.array_equal(terrain.height[44], expected[44])


def test_old_ramps_default_to_side_smoothing_disabled():
    payload, _ = _ramp_payload()
    project = ProjectDocument.model_validate(payload)
    ramp = project.road_ramps[0]
    assert ramp.smooth_sides is False
    assert ramp.follow_terrain is True


def test_terrain_ramp_changes_height_without_painting_a_road():
    payload, _ = _ramp_payload()
    payload["road_ramps"][0]["kind"] = "terrain"
    project = ProjectDocument.model_validate(payload)
    terrain = compile_project(project)
    assert np.any(np.diff(terrain.height[32, 8:57]) > 0)
    assert np.all(terrain.road_mask == 0)
    assert terrain.validation["road_ramps"]["count"] == 0
    assert terrain.validation["terrain_ramps"]["count"] == 1
    assert terrain.validation["terrain_ramps"]["valid"] == 1


def test_legacy_ramps_default_to_road_kind():
    payload, _ = _ramp_payload()
    project = ProjectDocument.model_validate(payload)
    assert project.road_ramps[0].kind == "road"
