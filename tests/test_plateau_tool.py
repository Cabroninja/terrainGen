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
