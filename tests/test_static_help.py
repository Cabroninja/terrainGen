import json
import re
from pathlib import Path


def test_all_value_labels_have_help_definitions():
    root = Path(__file__).parents[1] / "app" / "static"
    html = (root / "index.html").read_text(encoding="utf-8")
    definitions = json.loads((root / "config-help.json").read_text(encoding="utf-8"))
    keys = set(re.findall(r'data-help="([^"]+)"', html))
    keys |= set(re.findall(r'data-help-only="([^"]+)"', html))
    assert keys
    assert keys <= definitions.keys()


def test_all_layers_have_help_definitions():
    root = Path(__file__).parents[1] / "app" / "static"
    javascript = (root / "app.js").read_text(encoding="utf-8")
    definitions = json.loads((root / "config-help.json").read_text(encoding="utf-8"))
    layer_keys = set(re.findall(r"help: '([^']+)'", javascript))
    assert len(layer_keys) == 10
    assert layer_keys <= definitions.keys()


def test_marker_ids_have_http_compatible_fallback():
    javascript = (Path(__file__).parents[1] / "app" / "static" / "app.js").read_text(encoding="utf-8")
    assert "function createMarkerId()" in javascript
    assert "typeof globalThis.crypto.randomUUID === 'function'" in javascript
    assert "marker-${Date.now().toString(36)}" in javascript
    assert "id: crypto.randomUUID()" not in javascript


def test_exit_markers_use_playable_boundary_and_visible_feedback():
    javascript = (Path(__file__).parents[1] / "app" / "static" / "app.js").read_text(encoding="utf-8")
    assert "nearestPlayableBoundary(point)" in javascript
    assert "markerPreviewPoint(point)" in javascript
    assert "colocada en X ${x}, Z ${z}" in javascript


def test_seed_randomization_is_present_and_bounded():
    root = Path(__file__).parents[1] / "app" / "static"
    html = (root / "index.html").read_text(encoding="utf-8")
    javascript = (root / "app.js").read_text(encoding="utf-8")
    assert 'id="randomize-seed"' in html
    assert "randomizeSeed()" in javascript
    assert "random[0] & maximum" in javascript


def test_height_stroke_can_disable_accumulation():
    root = Path(__file__).parents[1] / "app" / "static"
    html = (root / "index.html").read_text(encoding="utf-8")
    javascript = (root / "app.js").read_text(encoding="utf-8")
    assert 'id="stroke-accumulation"' in html
    assert "this.strokeBaseValues = new Map()" in javascript
    assert "alpha <= previousInfluence" in javascript
    assert "source = this.strokeBaseValues" in javascript


def test_terrain_3d_has_expand_mode():
    root = Path(__file__).parents[1] / "app" / "static"
    html = (root / "index.html").read_text(encoding="utf-8")
    viewer = (root / "terrain-viewer.js").read_text(encoding="utf-8")
    styles = (root / "styles.css").read_text(encoding="utf-8")
    assert 'id="terrain-3d-expand"' in html
    assert "setExpanded(expanded)" in viewer
    assert ".terrain-3d-view.is-expanded" in styles


def test_direct_brush_core_controls_are_present():
    root = Path(__file__).parents[1] / "app" / "static"
    html = (root / "index.html").read_text(encoding="utf-8")
    javascript = (root / "app.js").read_text(encoding="utf-8")
    assert 'id="brush-core-mode"' in html
    assert 'id="brush-core-radius"' in html
    assert "coreRadius" in javascript
    assert "transición ${transition.toFixed(1)}" in javascript


def test_named_presets_exist_for_three_sections():
    root = Path(__file__).parents[1] / "app" / "static"
    html = (root / "index.html").read_text(encoding="utf-8")
    javascript = (root / "app.js").read_text(encoding="utf-8")
    for group in ("brush", "compilation", "mountain"):
        assert f'id="{group}-preset-save"' in html
        assert f'id="{group}-preset-load"' in html
        assert f'id="{group}-preset-delete"' in html
    assert "const PRESET_GROUPS" in javascript
    assert "localStorage" in javascript


def test_editor_accepts_maps_up_to_2048():
    root = Path(__file__).parents[1] / "app" / "static"
    html = (root / "index.html").read_text(encoding="utf-8")
    javascript = (root / "app.js").read_text(encoding="utf-8")
    assert 'max="2048"' in html
    assert "const MAX_MAP_SIZE = 2048" in javascript
    assert "const MIN_MAP_SIZE = 32" in javascript


def test_voxel_viewer_has_chunked_minecraft_controls():
    root = Path(__file__).parents[1] / "app" / "static"
    html = (root / "index.html").read_text(encoding="utf-8")
    app_js = (root / "app.js").read_text(encoding="utf-8")
    viewer = (root / "voxel-viewer.js").read_text(encoding="utf-8")
    styles = (root / "styles.css").read_text(encoding="utf-8")
    assert 'data-preview="voxel3d"' in html
    assert 'id="voxel-3d-mode"' in html
    assert 'id="voxel-render-distance"' in html
    assert 'id="voxel-cut-y"' in html
    assert "new VoxelTerrainViewer" in app_js
    assert "jkr-voxel-chunk" in viewer
    assert "requestPointerLock" in viewer
    assert ".voxel-3d-view.is-expanded" in styles


def test_advanced_elevation_profile_controls_are_present():
    root = Path(__file__).parents[1] / "app" / "static"
    html = (root / "index.html").read_text(encoding="utf-8")
    javascript = (root / "app.js").read_text(encoding="utf-8")
    for control in (
        "elevation-profile-enabled", "brush-slope-width", "brush-base-enabled",
        "brush-base-width", "brush-base-intensity", "brush-profile-shape",
        "brush-terrace-steps", "brush-strict-clip",
    ):
        assert f'id="{control}"' in html
    assert "elevationProfileInfluence" in javascript
    assert "slopeEnd" in javascript
    assert "Radio exterior" in javascript


def test_height_base_uses_explicit_plateau_and_optional_support():
    root = Path(__file__).parents[1] / "app" / "static"
    html = (root / "index.html").read_text(encoding="utf-8")
    javascript = (root / "app.js").read_text(encoding="utf-8")
    for control in ("plateau-height", "plateau-radius", "plateau-slope-width", "plateau-support-enabled", "plateau-support-width", "plateau-support-height", "plateau-pick-height", "plateau-action"):
        assert f'id="{control}"' in html
    assert "kind: 'plateau'" in javascript
    assert "plateauInfluence" in javascript
    assert "source + (value - source) * alpha" in javascript
    assert "settings.plateauMode" in javascript
    assert "Círculo amarillo: superficie plana" in html
    assert "Círculo blanco: final de la pendiente" in html
    assert "Círculo verde: final del soporte exterior" in html
    assert "road-fit-width" not in html
    assert "reserved-fit-width" not in html


def test_height_base_tool_hides_the_advanced_brush_panel():
    root = Path(__file__).parents[1] / "app" / "static"
    html = (root / "index.html").read_text(encoding="utf-8")
    javascript = (root / "app.js").read_text(encoding="utf-8")
    assert 'id="plateau-tool-panel"' in html
    assert 'id="standard-brush-panel"' in html
    assert "$('plateau-tool-panel').hidden = !plateauLayer" in javascript
    assert "$('plateau-brush-fields').hidden = !plateauBrushMode" in javascript
    assert "$('standard-brush-panel').hidden = plateauLayer || rampMode || waterLayer || structureLayer" in javascript
    assert "$('plateau-tool-mode').value === 'ramp'" in javascript
    assert "const heightLayer = kind === 'modifier'" in javascript


def test_explicit_road_ramp_editor_is_present():
    root = Path(__file__).parents[1] / "app" / "static"
    html = (root / "index.html").read_text(encoding="utf-8")
    javascript = (root / "app.js").read_text(encoding="utf-8")
    module = (root / "road-ramp-tool.js").read_text(encoding="utf-8")
    for control in (
        "road-tool-mode", "road-ramp-width", "road-ramp-shoulder", "road-ramp-ratio",
        "road-ramp-start-landing", "road-ramp-end-landing", "road-ramp-smooth-sides",
        "road-ramp-side-ratio", "road-ramp-max-side-width", "road-ramp-side-roundness",
        "road-ramp-follow-terrain", "road-ramp-finish", "road-ramp-undo-point",
        "road-ramp-cancel", "road-ramp-list",
    ):
        assert f'id="{control}"' in html
    assert "road_ramps: structuredClone(this.roadRamps)" in javascript
    assert "finishRoadRampDraft()" in javascript
    assert "analyzeRoadRamp" in module


def test_ramp_controls_have_tooltips_and_voxel_distance_reaches_16():
    root = Path(__file__).parents[1] / "app" / "static"
    html = (root / "index.html").read_text(encoding="utf-8")
    definitions = json.loads((root / "config-help.json").read_text(encoding="utf-8"))
    for key in (
        "road_tool_mode", "road_ramp_label", "road_ramp_type", "road_ramp_width",
        "road_ramp_shoulder", "road_ramp_ratio", "road_ramp_start_landing",
        "road_ramp_end_landing", "road_ramp_smooth_sides", "road_ramp_side_ratio",
        "road_ramp_max_side_width", "road_ramp_side_roundness", "road_ramp_follow_terrain",
        "road_ramp_finish", "road_ramp_undo_point", "road_ramp_cancel",
    ):
        assert key in definitions
    assert 'id="voxel-render-distance" type="range" min="1" max="16"' in html


def test_freehand_water_editor_and_outlet_controls_are_present():
    root = Path(__file__).parents[1] / "app" / "static"
    html = (root / "index.html").read_text(encoding="utf-8")
    javascript = (root / "app.js").read_text(encoding="utf-8")
    module = (root / "water-course-tool.js").read_text(encoding="utf-8")
    styles = (root / "styles.css").read_text(encoding="utf-8")
    for control in (
        "water-tool-mode", "water-mass-action", "water-width", "water-depth",
        "water-shore-width", "water-shore-profile", "water-road-policy",
        "water-course-smoothing", "water-course-exit", "water-course-apply",
        "water-course-cancel", "water-course-list",
    ):
        assert f'id="{control}"' in html
    assert "water_courses: structuredClone(this.waterCourses)" in javascript
    assert "beginWaterCourseStroke" in javascript
    assert "smoothFreehandCourse" in module
    assert ".water-course-legend" in styles


def test_mass_water_settings_are_isolated_from_river_editing():
    javascript = (Path(__file__).parents[1] / "app" / "static" / "app.js").read_text(encoding="utf-8")
    assert "this.massWaterSettings" in javascript
    assert "this.riverWaterSettings" in javascript
    assert "const massWater = this.massWaterSettings" in javascript
    assert "shore_width: massWater.shoreWidth" in javascript
