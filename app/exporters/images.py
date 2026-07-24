from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from app.core.models import ProjectConfig
from app.terrain.compiler import CompiledTerrain

MATERIAL_COLORS = np.array([
    [82, 112, 82],   # auto
    [78, 132, 70],   # grass
    [126, 92, 58],   # dirt
    [104, 108, 112], # stone
    [194, 174, 112], # sand
    [224, 232, 232], # snow
    [126, 126, 116], # gravel
    [54, 105, 150],  # water
], dtype=np.uint8)


def _save_rgb(path: Path, rgb: np.ndarray) -> None:
    Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), mode="RGB").save(path)


def write_preview_images(output_dir: Path, config: ProjectConfig, terrain: CompiledTerrain) -> dict[str, str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    display_min = min(float(config.min_height), float(terrain.height.min(initial=config.min_height)))
    display_max = max(float(config.max_height), float(terrain.height.max(initial=config.max_height)))
    normalized = (terrain.height.astype(np.float32) - display_min) / max(1.0, display_max - display_min)
    shade = np.clip(0.62 + normalized[..., None] * 0.52, 0.45, 1.18)
    base = MATERIAL_COLORS[np.clip(terrain.material, 0, len(MATERIAL_COLORS) - 1)]
    preview = np.clip(base.astype(np.float32) * shade, 0, 255).astype(np.uint8)
    preview[terrain.road_mask == 1] = [178, 166, 132]
    preview[terrain.road_mask == 2] = [139, 103, 68]
    preview[terrain.reserved_mask > 0] = (preview[terrain.reserved_mask > 0].astype(np.float32) * 0.7 + np.array([188, 116, 198]) * 0.3).astype(np.uint8)
    outside = terrain.playable_mask == 0
    preview[outside] = np.clip(preview[outside].astype(np.float32) * 0.72, 0, 255).astype(np.uint8)
    strong_mountain = terrain.mountain_mask > 0.58
    preview[strong_mountain] = np.clip(preview[strong_mountain].astype(np.float32) * 0.90 + np.array([35, 36, 38]) * 0.10, 0, 255).astype(np.uint8)
    corridor = terrain.exit_corridor_mask > 0
    preview[corridor] = np.clip(preview[corridor].astype(np.float32) * 0.88 + np.array([115, 98, 72]) * 0.12, 0, 255).astype(np.uint8)

    image = Image.fromarray(preview, mode="RGB")
    draw = ImageDraw.Draw(image)
    for marker in terrain.markers:
        color = {"spawn": (250, 230, 95), "exit": (246, 92, 92), "poi": (225, 116, 240)}.get(marker["type"], (255, 255, 255))
        x, z, radius = int(marker["x"]), int(marker["z"]), max(2, min(8, int(marker.get("radius", 5)) // 3))
        draw.ellipse((x - radius, z - radius, x + radius, z + radius), outline=color, width=max(1, config.width // 256))

    preview_path = output_dir / f"{config.name}_preview.png"
    image.save(preview_path)
    height_values = np.clip(normalized * 255, 0, 255).astype(np.uint8)
    Image.fromarray(height_values, mode="L").save(output_dir / f"{config.name}_heightmap.png")
    slope_values = np.clip(terrain.slope / max(0.01, config.max_walk_slope) * 255, 0, 255).astype(np.uint8)
    Image.fromarray(slope_values, mode="L").save(output_dir / f"{config.name}_slope.png")
    walk = np.zeros((*terrain.walkable.shape, 3), dtype=np.uint8)
    walk[terrain.walkable > 0] = [84, 178, 108]
    walk[terrain.walkable == 0] = [174, 70, 70]
    walk[terrain.water_mask > 0] = [55, 105, 166]
    _save_rgb(output_dir / f"{config.name}_walkability.png", walk)
    return {
        "preview": preview_path.name,
        "heightmap": f"{config.name}_heightmap.png",
        "slope": f"{config.name}_slope.png",
        "walkability": f"{config.name}_walkability.png",
    }
