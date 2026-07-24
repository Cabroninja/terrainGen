import json
import subprocess
from pathlib import Path


def run_profile(config: dict, distances: list[float]) -> dict:
    module = Path(__file__).parents[1] / "app" / "static" / "brush-profile.js"
    script = f"""
      import {{ normalizeElevationProfile, elevationProfileInfluence }} from {json.dumps(module.as_uri())};
      const config = {json.dumps(config)};
      console.log(JSON.stringify({{
        normalized: normalizeElevationProfile(config),
        influence: {json.dumps(distances)}.map((distance) => elevationProfileInfluence(distance, config)),
      }}));
    """
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


def test_plateau_slope_and_base_have_independent_radii():
    result = run_profile(
        {
            "coreRadius": 19,
            "slopeWidth": 4,
            "baseEnabled": True,
            "baseWidth": 8,
            "baseIntensity": 25,
            "profile": "linear",
            "terraceSteps": 6,
        },
        [0, 19, 21, 23, 27, 31, 32],
    )
    assert result["normalized"]["radius"] == 31
    assert result["influence"][0] == 1
    assert result["influence"][1] == 1
    assert 0.6 < result["influence"][2] < 0.7
    assert result["influence"][3] == 0.25
    assert 0.12 < result["influence"][4] < 0.13
    assert result["influence"][5] == 0
    assert result["influence"][6] == 0


def test_base_can_be_disabled_for_a_hard_platform():
    result = run_profile(
        {
            "coreRadius": 19,
            "slopeWidth": 0,
            "baseEnabled": False,
            "baseWidth": 20,
            "baseIntensity": 50,
            "profile": "smooth",
        },
        [18.9, 19, 19.1],
    )
    assert result["normalized"]["radius"] == 19
    assert result["influence"] == [1, 1, 0]


def test_terraced_profile_quantizes_the_descent():
    result = run_profile(
        {
            "coreRadius": 4,
            "slopeWidth": 8,
            "baseEnabled": False,
            "profile": "terraced",
            "terraceSteps": 4,
        },
        [5, 7, 9, 11, 12],
    )
    allowed = {0, 0.25, 0.5, 0.75, 1}
    assert set(result["influence"]) <= allowed
    assert result["influence"][-1] == 0
