import json
import subprocess
from pathlib import Path


def run_plateau(config: dict, distances: list[float]) -> dict:
    module = Path(__file__).parents[1] / "app" / "static" / "plateau-tool.js"
    script = f"""
      import {{ normalizePlateauSettings, plateauInfluence, heightToLayerValue, layerValueToHeight }} from {json.dumps(module.as_uri())};
      const config = {json.dumps(config)};
      const value = heightToLayerValue(config.targetHeight, config.minHeight, config.maxHeight);
      console.log(JSON.stringify({{
        normalized: normalizePlateauSettings(config),
        influence: {json.dumps(distances)}.map((distance) => plateauInfluence(distance, config)),
        layerValue: value,
        resolvedHeight: layerValueToHeight(value, config.minHeight, config.maxHeight),
      }}));
    """
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


def test_plateau_has_flat_core_and_single_bounded_slope():
    result = run_plateau(
        {"targetHeight": 82, "plateauRadius": 19, "slopeWidth": 8, "minHeight": 18, "maxHeight": 120},
        [0, 19, 21, 23, 25, 27, 28],
    )
    assert result["normalized"]["radius"] == 27
    assert result["influence"][0] == 1
    assert result["influence"][1] == 1
    assert 0 < result["influence"][2] < 1
    assert result["influence"][3] == 0.5
    assert 0 < result["influence"][4] < 0.5
    assert result["influence"][5] == 0
    assert result["influence"][6] == 0


def test_zero_slope_produces_a_hard_platform():
    result = run_plateau(
        {"targetHeight": 70, "plateauRadius": 12, "slopeWidth": 0, "minHeight": 18, "maxHeight": 120},
        [11.9, 12, 12.01],
    )
    assert result["normalized"]["radius"] == 12
    assert result["influence"] == [1, 1, 0]


def test_absolute_height_round_trip_matches_selected_y():
    result = run_plateau(
        {"targetHeight": 85, "plateauRadius": 10, "slopeWidth": 5, "minHeight": 18, "maxHeight": 120},
        [0],
    )
    assert result["resolvedHeight"] == 85


def test_support_is_the_only_optional_outer_influence():
    result = run_plateau(
        {
            "targetHeight": 90,
            "plateauRadius": 12,
            "slopeWidth": 0,
            "supportEnabled": True,
            "supportWidth": 24,
            "supportHeightPercent": 25,
            "minHeight": 18,
            "maxHeight": 120,
        },
        [12, 12.01, 18, 24, 30, 35.99, 36, 37],
    )
    assert result["normalized"]["slopeEndRadius"] == 12
    assert result["normalized"]["radius"] == 36
    assert result["normalized"]["supportInfluence"] == 0.25
    assert result["influence"][0] == 1
    assert 0 < result["influence"][1] <= 0.25
    assert result["influence"][3] == 0.125
    assert 0 < result["influence"][5] < 0.01
    assert result["influence"][6] == 0
    assert result["influence"][7] == 0


def test_slope_and_support_have_independent_limits():
    result = run_plateau(
        {
            "targetHeight": 90,
            "plateauRadius": 10,
            "slopeWidth": 6,
            "supportEnabled": True,
            "supportWidth": 8,
            "supportHeightPercent": 30,
            "minHeight": 18,
            "maxHeight": 120,
        },
        [10, 13, 16, 20, 24, 25],
    )
    assert result["normalized"]["slopeEndRadius"] == 16
    assert result["normalized"]["radius"] == 24
    assert result["influence"][0] == 1
    assert 0.3 < result["influence"][1] < 1
    assert abs(result["influence"][2] - 0.3) < 1e-9
    assert 0 < result["influence"][3] < 0.3
    assert result["influence"][4] == 0
    assert result["influence"][5] == 0


def run_plateau_objects(objects: list[dict], probes: list[tuple[int, int]]) -> dict:
    module = Path(__file__).parents[1] / "app" / "static" / "plateau-tool.js"
    script = f"""
      import {{ rasterizePlateauObjects, plateauObjectContainsPoint }} from {json.dumps(module.as_uri())};
      const width = 32; const length = 32;
      const base = new Uint8Array(width * length); base.fill(128);
      const objects = {json.dumps(objects)};
      const rendered = rasterizePlateauObjects(base, width, length, objects, 18, 120);
      const probes = {json.dumps(probes)};
      console.log(JSON.stringify({{
        values: probes.map(([x, z]) => rendered[z * width + x]),
        hits: probes.map(([x, z]) => objects.map((item) => plateauObjectContainsPoint(item, {{ x, z }}, 18, 120))),
      }}));
    """
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


def test_editable_plateau_regenerates_without_leaving_old_radius():
    large = {
        "id": "p1",
        "points": [{"x": 16, "z": 16}],
        "target_height": 90,
        "plateau_radius": 6,
        "slope_width": 0,
        "support_enabled": False,
        "support_width": 0,
        "support_height_percent": 0,
    }
    small = {**large, "plateau_radius": 3}
    before = run_plateau_objects([large], [(16, 16), (21, 16)])
    after = run_plateau_objects([small], [(16, 16), (21, 16)])
    assert before["values"][0] > 128
    assert before["values"][1] > 128
    assert after["values"][0] > 128
    assert after["values"][1] == 128


def test_editable_plateau_height_can_be_changed_with_same_shape():
    low = {
        "id": "p1",
        "points": [{"x": 10, "z": 10}, {"x": 18, "z": 10}],
        "target_height": 65,
        "plateau_radius": 4,
        "slope_width": 2,
        "support_enabled": True,
        "support_width": 3,
        "support_height_percent": 25,
    }
    high = {**low, "target_height": 100}
    low_result = run_plateau_objects([low], [(10, 10), (14, 10), (18, 10)])
    high_result = run_plateau_objects([high], [(10, 10), (14, 10), (18, 10)])
    assert all(high_value > low_value for high_value, low_value in zip(high_result["values"], low_result["values"], strict=True))


def test_plateau_selection_uses_existing_full_profile_radius():
    plateau = {
        "id": "p1",
        "points": [{"x": 16, "z": 16}],
        "target_height": 90,
        "plateau_radius": 4,
        "slope_width": 3,
        "support_enabled": True,
        "support_width": 4,
        "support_height_percent": 25,
    }
    result = run_plateau_objects([plateau], [(16, 16), (26, 16), (28, 16)])
    assert result["hits"][0] == [True]
    assert result["hits"][1] == [True]
    assert result["hits"][2] == [False]


def run_plateau_merge(first: dict, second: dict, probes: list[tuple[int, int]]) -> dict:
    module = Path(__file__).parents[1] / "app" / "static" / "plateau-tool.js"
    script = f"""
      import {{ plateauObjectsCanMerge, mergePlateauObjects, plateauObjectStrokes, rasterizePlateauObjects }} from {json.dumps(module.as_uri())};
      const first = {json.dumps(first)};
      const second = {json.dumps(second)};
      const canMerge = plateauObjectsCanMerge(first, second, 18, 120);
      const merged = canMerge ? mergePlateauObjects([first, second], 18, 120) : null;
      const width = 48; const length = 32;
      const base = new Uint8Array(width * length); base.fill(128);
      const rendered = merged ? rasterizePlateauObjects(base, width, length, [merged], 18, 120) : base;
      console.log(JSON.stringify({{
        canMerge,
        merged,
        strokeCount: merged ? plateauObjectStrokes(merged, 18, 120).length : 0,
        values: {json.dumps(probes)}.map(([x, z]) => rendered[z * width + x]),
      }}));
    """
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


def test_touching_passes_with_same_parameters_merge_as_one_plateau():
    first = {
        "id": "p1",
        "points": [{"x": 10, "z": 12}, {"x": 18, "z": 12}],
        "target_height": 90,
        "plateau_radius": 4,
        "slope_width": 3,
        "support_enabled": True,
        "support_width": 4,
        "support_height_percent": 25,
    }
    second = {
        **first,
        "id": "p2",
        "points": [{"x": 16, "z": 17}, {"x": 24, "z": 17}],
    }
    result = run_plateau_merge(first, second, [(10, 12), (20, 15), (24, 17)])
    assert result["canMerge"] is True
    assert result["strokeCount"] == 2
    assert result["merged"]["stroke_breaks"] == [2]
    assert all(value > 128 for value in result["values"])


def test_separate_passes_with_same_height_remain_different_plateaus():
    first = {
        "id": "p1",
        "points": [{"x": 8, "z": 10}],
        "target_height": 90,
        "plateau_radius": 4,
        "slope_width": 2,
        "support_enabled": False,
        "support_width": 0,
        "support_height_percent": 0,
    }
    second = {**first, "id": "p2", "points": [{"x": 25, "z": 10}]}
    result = run_plateau_merge(first, second, [(8, 10), (25, 10)])
    assert result["canMerge"] is False
    assert result["merged"] is None


def test_touching_passes_with_different_existing_parameter_do_not_merge():
    first = {
        "id": "p1",
        "points": [{"x": 10, "z": 10}],
        "target_height": 90,
        "plateau_radius": 5,
        "slope_width": 2,
        "support_enabled": False,
        "support_width": 0,
        "support_height_percent": 0,
    }
    second = {**first, "id": "p2", "points": [{"x": 14, "z": 10}], "target_height": 91}
    result = run_plateau_merge(first, second, [(10, 10), (14, 10)])
    assert result["canMerge"] is False


def test_merged_strokes_do_not_draw_an_artificial_connector_between_passes():
    first = {
        "id": "p1",
        "points": [{"x": 6, "z": 8}],
        "target_height": 90,
        "plateau_radius": 4,
        "slope_width": 0,
        "support_enabled": False,
        "support_width": 0,
        "support_height_percent": 0,
    }
    # Toca la primera pasada por el extremo inicial, pero luego se aleja hacia abajo.
    # El hueco central diagonal no debe rellenarse mediante una línea que conecte
    # automáticamente el final de una pasada con el inicio de la siguiente.
    second = {**first, "id": "p2", "points": [{"x": 13, "z": 8}, {"x": 13, "z": 24}]}
    result = run_plateau_merge(first, second, [(6, 8), (13, 20), (9, 16)])
    assert result["canMerge"] is True
    assert result["strokeCount"] == 2
    assert result["values"][0] > 128
    assert result["values"][1] > 128
    assert result["values"][2] == 128
