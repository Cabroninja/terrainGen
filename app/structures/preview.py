from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

from app.structures.placement import block_color_for_state
from app.structures.schematic_reader import ParsedSchematic

MAX_PREVIEW_BLOCKS = 60_000
MAX_THUMBNAIL_BLOCKS = 45_000
PREVIEW_PAYLOAD_VERSION = 2

MATERIAL_FAMILY_IDS = {
    "default": 0,
    "log": 1,
    "leaves": 2,
    "stone": 3,
    "ore": 4,
    "grass": 5,
    "sand": 6,
    "planks": 7,
    "brick": 8,
    "water": 9,
    "snow": 10,
    "mushroom": 11,
    "flower": 12,
    "glass": 13,
    "copper": 14,
    "dirt": 15,
}


def _sample_blocks(blocks: list[tuple[int, int, int, str]], maximum: int) -> tuple[list[tuple[int, int, int, str]], bool]:
    if len(blocks) <= maximum:
        return blocks, False
    stride = len(blocks) / maximum
    sampled = [blocks[min(len(blocks) - 1, int(index * stride))] for index in range(maximum)]
    return sampled, True


def _rgb(state: str) -> tuple[int, int, int, int]:
    red, green, blue, alpha = block_color_for_state(state)
    return (
        max(0, min(255, round(red * 255))),
        max(0, min(255, round(green * 255))),
        max(0, min(255, round(blue * 255))),
        max(0, min(255, round(alpha * 255))),
    )


def build_preview_payload(parsed: ParsedSchematic) -> dict:
    """Build the compact WebGL payload used by the rotatable library preview.

    Version 2 shares the same simplified Minecraft material language used by
    gallery thumbnails. Materials are stored once in a palette and blocks only
    reference their palette index, keeping large previews reasonably compact.
    """
    blocks, sampled = _sample_blocks(parsed.blocks, MAX_PREVIEW_BLOCKS)
    material_indexes: dict[str, int] = {}
    materials: list[list[int]] = []
    preview_blocks: list[list[int]] = []

    for x, y, z, state in blocks:
        material_index = material_indexes.get(state)
        if material_index is None:
            texture = _state_texture(state)
            material_index = len(materials)
            material_indexes[state] = material_index
            materials.append([
                MATERIAL_FAMILY_IDS.get(texture["family"], 0),
                *texture["top"],
                *texture["left"],
                *texture["right"],
                *texture["accent"],
                texture["hash"] & 0xFFFF,
            ])
        preview_blocks.append([x, y, z, material_index])

    return {
        "format": "jkr-schematic-preview",
        "version": PREVIEW_PAYLOAD_VERSION,
        "width": parsed.width,
        "height": parsed.height,
        "length": parsed.length,
        "block_count": parsed.block_count,
        "displayed_blocks": len(blocks),
        "sampled": sampled,
        "anchor": [parsed.anchor_x, parsed.anchor_y, parsed.anchor_z],
        "materials": materials,
        "blocks": preview_blocks,
    }


def _shade(color: tuple[int, int, int, int], factor: float) -> tuple[int, int, int, int]:
    return (
        max(0, min(255, round(color[0] * factor))),
        max(0, min(255, round(color[1] * factor))),
        max(0, min(255, round(color[2] * factor))),
        color[3],
    )


def _mix(a: tuple[int, int, int, int], b: tuple[int, int, int, int], amount: float) -> tuple[int, int, int, int]:
    inv = 1.0 - amount
    return (
        round(a[0] * inv + b[0] * amount),
        round(a[1] * inv + b[1] * amount),
        round(a[2] * inv + b[2] * amount),
        round(a[3] * inv + b[3] * amount),
    )


def _stable_hash(text: str) -> int:
    value = 2166136261
    for char in text:
        value ^= ord(char)
        value = (value * 16777619) & 0xFFFFFFFF
    return value


def _contains_any(name: str, values: tuple[str, ...]) -> bool:
    return any(value in name for value in values)


def _named_palette(name: str, palettes: tuple[tuple[tuple[str, ...], tuple[int, int, int, int]], ...], fallback):
    for tokens, color in palettes:
        if _contains_any(name, tokens):
            return color
    return fallback


def _state_texture(state: str) -> dict:
    name = state.split('[', 1)[0].removeprefix('minecraft:')
    base = _rgb(state)
    hashed = _stable_hash(name)
    variant = ((hashed >> 8) & 0xFF) / 255.0
    accent_shift = 0.08 + variant * 0.08

    def pick(color: tuple[int, int, int, int], bright: float, dark: float, accent: float = 0.5):
        top = _shade(color, bright)
        left = _shade(color, dark)
        right = _shade(color, (bright + dark) / 2)
        accent_color = _mix(top, (255, 255, 255, color[3]), accent_shift * accent)
        return top, left, right, accent_color

    family = 'default'
    top, left, right, accent = pick(base, 1.06, 0.72)

    wood_palettes = (
        (('dark_oak',), (74, 52, 31, 255)),
        (('spruce',), (91, 66, 38, 255)),
        (('birch',), (202, 190, 142, 255)),
        (('jungle',), (136, 94, 55, 255)),
        (('acacia',), (151, 83, 51, 255)),
        (('mangrove',), (105, 49, 44, 255)),
        (('cherry',), (197, 139, 144, 255)),
        (('pale_oak',), (190, 184, 166, 255)),
        (('crimson',), (111, 42, 62, 255)),
        (('warped',), (44, 110, 104, 255)),
        (('bamboo',), (183, 166, 77, 255)),
        (('oak',), (123, 91, 51, 255)),
    )
    leaf_palettes = (
        (('spruce',), (46, 84, 48, 255)),
        (('birch',), (103, 145, 63, 255)),
        (('jungle',), (43, 119, 48, 255)),
        (('acacia',), (92, 129, 61, 255)),
        (('dark_oak',), (43, 91, 39, 255)),
        (('mangrove',), (69, 121, 54, 255)),
        (('cherry',), (215, 139, 164, 255)),
        (('pale_oak',), (117, 137, 102, 255)),
        (('azalea',), (74, 134, 60, 255)),
        (('oak',), (65, 126, 54, 255)),
    )

    if 'grass_block' in name:
        family = 'grass'
        top = (96, 152, 70, 255)
        left = (106, 82, 48, 255)
        right = (128, 97, 58, 255)
        accent = (134, 191, 91, 255)
    elif _contains_any(name, ('leaves', 'moss', 'azalea')):
        family = 'leaves'
        green = _named_palette(name, leaf_palettes, (61, 124, 50, 255))
        top, left, right, accent = pick(green, 1.10, 0.70, 0.85)
    elif _contains_any(name, ('log', 'wood', 'stem', 'hyphae')):
        family = 'log'
        bark = _named_palette(name, wood_palettes, (116, 82, 46, 255))
        ring = _mix(_shade(bark, 1.55), (226, 202, 153, 255), 0.42)
        top = ring
        left = _shade(bark, 0.70)
        right = _shade(bark, 0.92)
        accent = _shade(bark, 0.52)
    elif 'planks' in name or 'bamboo_block' in name:
        family = 'planks'
        plank = _named_palette(name, wood_palettes, (171, 133, 82, 255))
        top, left, right, accent = pick(_shade(plank, 1.20), 1.03, 0.76, 0.65)
        accent = _shade(plank, 0.63)
    elif 'ore' in name or _contains_any(name, ('ancient_debris', 'nether_quartz')):
        family = 'ore'
        host = (73, 75, 81, 255) if 'deepslate' in name else (126, 128, 131, 255)
        ore_colors = (
            (('coal',), (45, 46, 48, 255)),
            (('raw_iron', 'iron'), (205, 164, 120, 255)),
            (('copper',), (196, 112, 74, 255)),
            (('gold',), (244, 198, 62, 255)),
            (('redstone',), (216, 47, 46, 255)),
            (('lapis',), (48, 87, 185, 255)),
            (('diamond',), (79, 220, 216, 255)),
            (('emerald',), (52, 201, 99, 255)),
            (('quartz',), (224, 218, 200, 255)),
            (('ancient_debris',), (121, 71, 58, 255)),
        )
        vein = _named_palette(name, ore_colors, (196, 149, 89, 255))
        top, left, right, _ = pick(host, 1.02, 0.77, 0.3)
        accent = vein
    elif _contains_any(name, ('stone', 'cobble', 'deepslate', 'tuff', 'andesite', 'diorite', 'granite', 'basalt', 'blackstone', 'calcite', 'dripstone', 'prismarine', 'end_stone')):
        family = 'stone'
        stone_palettes = (
            (('cobbled_deepslate',), (69, 68, 74, 255)),
            (('deepslate',), (75, 76, 82, 255)),
            (('blackstone',), (54, 50, 57, 255)),
            (('basalt',), (73, 72, 76, 255)),
            (('granite',), (149, 104, 90, 255)),
            (('diorite',), (191, 190, 186, 255)),
            (('andesite',), (126, 128, 130, 255)),
            (('tuff',), (105, 117, 102, 255)),
            (('calcite',), (220, 216, 203, 255)),
            (('dripstone',), (137, 102, 81, 255)),
            (('dark_prismarine',), (52, 92, 86, 255)),
            (('prismarine',), (93, 154, 142, 255)),
            (('end_stone',), (218, 220, 158, 255)),
            (('mossy',), (103, 119, 83, 255)),
            (('cobble',), (117, 119, 119, 255)),
        )
        stone = _named_palette(name, stone_palettes, (128, 130, 133, 255))
        top, left, right, accent = pick(stone, 1.04, 0.75, 0.55)
        accent = _shade(stone, 0.60 if 'cobble' in name else 1.20)
    elif _contains_any(name, ('sand', 'sandstone')):
        family = 'sand'
        sand = (193, 117, 91, 255) if 'red_' in name else (219, 203, 151, 255)
        top, left, right, accent = pick(sand, 1.05, 0.81, 0.55)
    elif _contains_any(name, ('dirt', 'mud', 'clay', 'farmland', 'podzol', 'mycelium', 'path')):
        family = 'dirt'
        soil_palettes = (
            (('mud',), (72, 68, 63, 255)),
            (('clay',), (156, 166, 177, 255)),
            (('podzol',), (92, 67, 43, 255)),
            (('mycelium',), (119, 102, 120, 255)),
            (('farmland',), (91, 63, 38, 255)),
            (('path',), (151, 124, 72, 255)),
            (('coarse_dirt',), (111, 78, 47, 255)),
        )
        soil = _named_palette(name, soil_palettes, (126, 91, 55, 255))
        top, left, right, accent = pick(soil, 1.04, 0.74, 0.45)
    elif 'water' in name:
        family = 'water'
        blue = (58, 112, 198, 218)
        top = _shade(blue, 1.08)
        left = _shade(blue, 0.80)
        right = _shade(blue, 0.93)
        accent = (148, 198, 255, 190)
    elif _contains_any(name, ('snow', 'ice')):
        family = 'snow'
        if 'blue_ice' in name:
            frozen = (110, 174, 234, 245)
        elif 'packed_ice' in name:
            frozen = (139, 193, 235, 242)
        elif 'ice' in name:
            frozen = (173, 211, 239, 230)
        else:
            frozen = (229, 239, 247, 255)
        top, left, right, accent = pick(frozen, 1.04, 0.83, 0.8)
    elif _contains_any(name, ('flower', 'tulip', 'poppy', 'rose', 'dandelion', 'orchid', 'allium', 'bluet')):
        family = 'flower'
        flower_palettes = (
            (('dandelion',), (239, 201, 54, 255)),
            (('blue_orchid', 'cornflower'), (78, 139, 221, 255)),
            (('allium', 'lilac'), (174, 104, 196, 255)),
            (('white_tulip', 'oxeye'), (230, 230, 219, 255)),
            (('orange_tulip',), (228, 126, 44, 255)),
            (('pink_tulip', 'peony'), (226, 126, 157, 255)),
        )
        bloom = _named_palette(name, flower_palettes, (199, 64, 75, 255))
        top, left, right, accent = pick(bloom, 1.10, 0.80, 0.85)
    elif _contains_any(name, ('bricks', 'brick', 'terracotta')):
        family = 'brick'
        brick = (84, 40, 44, 255) if 'nether' in name else (153, 81, 67, 255)
        if 'mud_brick' in name:
            brick = (137, 103, 73, 255)
        top, left, right, accent = pick(brick, 1.04, 0.77, 0.55)
        accent = _shade(brick, 0.55)
    elif 'mushroom' in name:
        family = 'mushroom'
        mush = (177, 62, 57, 255) if 'red' in name else (145, 106, 78, 255)
        top, left, right, accent = pick(mush, 1.07, 0.79, 0.65)
    elif _contains_any(name, ('glass', 'pane')):
        family = 'glass'
        stained_glass = (176, 214, 222, 150)
        dye_palettes = (
            (('red_',), (205, 70, 66, 155)),
            (('blue_',), (64, 94, 190, 155)),
            (('green_',), (76, 143, 74, 155)),
            (('yellow_',), (226, 205, 69, 155)),
            (('purple_', 'magenta_'), (158, 82, 178, 155)),
            (('black_',), (52, 55, 61, 170)),
            (('white_',), (224, 231, 232, 155)),
        )
        glass = _named_palette(name, dye_palettes, stained_glass)
        top, left, right, accent = pick(glass, 1.03, 0.82, 0.95)
    elif _contains_any(name, ('copper', 'oxidized', 'weathered', 'exposed')):
        family = 'copper'
        copper = (168, 105, 72, 255)
        if 'oxidized' in name:
            copper = (70, 145, 125, 255)
        elif 'weathered' in name:
            copper = (93, 133, 114, 255)
        elif 'exposed' in name:
            copper = (145, 119, 83, 255)
        top, left, right, accent = pick(copper, 1.06, 0.78, 0.55)

    return {'family': family, 'top': top, 'left': left, 'right': right, 'accent': accent, 'hash': hashed}


def _line(draw: ImageDraw.ImageDraw, a: tuple[float, float], b: tuple[float, float], fill, width: int = 1):
    draw.line((round(a[0]), round(a[1]), round(b[0]), round(b[1])), fill=fill, width=width)


def _lerp(a: tuple[float, float], b: tuple[float, float], t: float) -> tuple[float, float]:
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def _diamond(draw: ImageDraw.ImageDraw, points: list[tuple[float, float]], color, inset: float):
    center = (sum(p[0] for p in points) / 4, sum(p[1] for p in points) / 4)
    scaled = [
        (center[0] + (p[0] - center[0]) * inset, center[1] + (p[1] - center[1]) * inset)
        for p in points
    ]
    for start, end in ((scaled[0], scaled[1]), (scaled[1], scaled[2]), (scaled[2], scaled[3]), (scaled[3], scaled[0])):
        _line(draw, start, end, color, 1)


def _draw_pattern(draw: ImageDraw.ImageDraw, polygon: list[tuple[float, float]], family: str, accent, face: str, seed: int, size_hint: float):
    if size_hint < 3.4:
        return
    width = 1 if size_hint < 8 else 2
    p0, p1, p2, p3 = polygon
    if family == 'log':
        if face == 'top':
            _diamond(draw, polygon, accent, 0.72)
            if size_hint >= 7:
                _diamond(draw, polygon, _shade(accent, 0.88), 0.47)
        else:
            count = 2 if size_hint < 6 else 3
            for index in range(1, count + 1):
                t = index / (count + 1)
                _line(draw, _lerp(p0, p1, t), _lerp(p3, p2, t), accent, width)
    elif family == 'leaves':
        spots = 3 if size_hint < 7 else 5
        for index in range(spots):
            u = ((seed >> (index * 3)) & 7) / 8
            v = ((seed >> (index * 5 + 2)) & 7) / 8
            a = _lerp(p0, p3, v)
            b = _lerp(p1, p2, v)
            c = _lerp(a, b, u)
            r = 1 if size_hint < 7 else 2
            draw.ellipse((c[0]-r, c[1]-r, c[0]+r, c[1]+r), fill=accent)
    elif family == 'stone':
        cracks = 2 if size_hint < 7 else 4
        for index in range(cracks):
            t0 = (((seed >> (index * 4)) & 7) + 1) / 9
            t1 = (((seed >> (index * 4 + 2)) & 7) + 1) / 9
            a = _lerp(p0, p1, t0)
            b = _lerp(p3, p2, t1)
            mid = _lerp(a, b, 0.55)
            _line(draw, a, mid, accent, width)
    elif family == 'ore':
        flecks = 3 if size_hint < 7 else 6
        for index in range(flecks):
            u = (((seed >> (index * 3)) & 7) + 1) / 9
            v = (((seed >> (index * 5 + 1)) & 7) + 1) / 9
            a = _lerp(p0, p3, v)
            b = _lerp(p1, p2, v)
            c = _lerp(a, b, u)
            radius = 1 if size_hint < 8 else 2
            draw.rectangle((round(c[0]-radius), round(c[1]-radius), round(c[0]+radius), round(c[1]+radius)), fill=accent)
    elif family == 'grass':
        if face == 'top':
            dots = 3 if size_hint < 7 else 5
            for index in range(dots):
                u = ((seed >> (index * 3)) & 7) / 8
                v = ((seed >> (index * 4 + 1)) & 7) / 8
                a = _lerp(p0, p3, v)
                b = _lerp(p1, p2, v)
                c = _lerp(a, b, u)
                draw.point((round(c[0]), round(c[1])), fill=accent)
        else:
            _line(draw, _lerp(p0, p3, 0.18), _lerp(p1, p2, 0.18), accent, width)
    elif family == 'sand':
        ripples = 2 if size_hint < 7 else 3
        for index in range(ripples):
            t = (index + 1) / (ripples + 1)
            _line(draw, _lerp(p0, p3, t), _lerp(p1, p2, t), accent, 1)
    elif family == 'planks':
        seams = 2 if size_hint < 7 else 3
        for index in range(seams):
            t = (index + 1) / (seams + 1)
            if face == 'top':
                _line(draw, _lerp(p0, p1, t), _lerp(p3, p2, t), accent, 1)
            else:
                _line(draw, _lerp(p0, p3, t), _lerp(p1, p2, t), accent, 1)
    elif family == 'brick':
        _line(draw, _lerp(p0, p3, 0.5), _lerp(p1, p2, 0.5), accent, 1)
        if size_hint >= 6:
            _line(draw, _lerp(p0, p1, 0.33), _lerp(p3, p2, 0.33), accent, 1)
            _line(draw, _lerp(p0, p1, 0.66), _lerp(p3, p2, 0.66), accent, 1)
    elif family == 'water':
        _line(draw, _lerp(p0, p3, 0.32), _lerp(p1, p2, 0.32), accent, 1)
        _line(draw, _lerp(p0, p3, 0.67), _lerp(p1, p2, 0.67), accent, 1)
    elif family == 'snow':
        _line(draw, _lerp(p0, p2, 0.5), _lerp(p1, p3, 0.5), accent, 1)
    elif family == 'mushroom':
        dots = 2 if size_hint < 7 else 4
        for index in range(dots):
            u = ((seed >> (index * 3)) & 7) / 8
            v = ((seed >> (index * 4 + 1)) & 7) / 8
            a = _lerp(p0, p3, v)
            b = _lerp(p1, p2, v)
            c = _lerp(a, b, u)
            r = 1 if size_hint < 7 else 2
            draw.ellipse((c[0]-r, c[1]-r, c[0]+r, c[1]+r), fill=(240, 236, 226, 215))
    elif family == 'flower':
        center = _lerp(_lerp(p0, p3, 0.55), _lerp(p1, p2, 0.55), 0.5)
        draw.ellipse((center[0]-1, center[1]-1, center[0]+1, center[1]+1), fill=(255, 236, 140, 245))
    elif family == 'glass':
        _line(draw, p0, p2, accent, 1)
        _line(draw, p1, p3, accent, 1)


def _draw_cube(draw: ImageDraw.ImageDraw, cx: float, cy: float, half_w: float, half_h: float, vertical: float, texture: dict):
    top = [(cx, cy - half_h), (cx + half_w, cy), (cx, cy + half_h), (cx - half_w, cy)]
    left = [(cx - half_w, cy), (cx, cy + half_h), (cx, cy + half_h + vertical), (cx - half_w, cy + vertical)]
    right = [(cx + half_w, cy), (cx, cy + half_h), (cx, cy + half_h + vertical), (cx + half_w, cy + vertical)]
    draw.polygon(left, fill=texture['left'])
    draw.polygon(right, fill=texture['right'])
    draw.polygon(top, fill=texture['top'])
    size_hint = max(half_w, half_h, vertical * 0.35)
    family = texture['family']
    seed = texture['hash']
    _draw_pattern(draw, left, family, texture['accent'], 'left', seed, size_hint)
    _draw_pattern(draw, right, family, _shade(texture['accent'], 0.92), 'right', seed >> 1, size_hint)
    _draw_pattern(draw, top, family, _shade(texture['accent'], 1.02), 'top', seed >> 2, size_hint)


def write_thumbnail(parsed: ParsedSchematic, path: Path, size: int = 320) -> None:
    """Render a lightweight isometric PNG used by the library gallery.

    The gallery keeps thumbnails simple for performance, but uses a Minecraft-like
    material language so trees, rocks and mixed schematics are easier to distinguish.
    """
    blocks, _ = _sample_blocks(parsed.blocks, MAX_THUMBNAIL_BLOCKS)
    background = (15, 20, 17, 255)
    image = Image.new('RGBA', (size, size), background)
    draw = ImageDraw.Draw(image, 'RGBA')

    projected: list[tuple[float, float, int, int, int, dict]] = []
    for x, y, z, state in blocks:
        px = (x - z) * 0.88
        py = (x + z) * 0.44 - y * 0.98
        projected.append((px, py, x, y, z, _state_texture(state)))
    min_x = min(item[0] for item in projected)
    max_x = max(item[0] for item in projected)
    min_y = min(item[1] for item in projected)
    max_y = max(item[1] for item in projected)
    span_x = max(1.0, max_x - min_x + 2.5)
    span_y = max(1.0, max_y - min_y + 3.0)
    scale = min((size - 34) / span_x, (size - 34) / span_y)
    origin_x = (size - span_x * scale) / 2 - min_x * scale + scale
    origin_y = (size - span_y * scale) / 2 - min_y * scale + scale * 1.35
    half_w = max(0.7, 0.74 * scale)
    half_h = max(0.45, 0.37 * scale)
    vertical = max(0.8, 0.78 * scale)

    projected.sort(key=lambda item: (item[2] + item[4], item[3], item[2]))
    for px, py, _x, _y, _z, texture in projected:
        cx = origin_x + px * scale
        cy = origin_y + py * scale
        if half_w < 1.3:
            draw.point((round(cx), round(cy)), fill=texture['top'])
            continue
        _draw_cube(draw, cx, cy, half_w, half_h, vertical, texture)

    draw.rounded_rectangle((2, 2, size - 3, size - 3), radius=14, outline=(73, 91, 79, 180), width=2)
    label = f"{parsed.width}×{parsed.height}×{parsed.length}"
    bbox = draw.textbbox((0, 0), label)
    text_width = bbox[2] - bbox[0]
    draw.rounded_rectangle((size - text_width - 22, size - 31, size - 8, size - 8), radius=8, fill=(5, 9, 7, 205))
    draw.text((size - text_width - 15, size - 26), label, fill=(218, 229, 221, 245))

    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    image.convert('RGB').save(temporary, format='PNG', optimize=True)
    temporary.replace(path)
