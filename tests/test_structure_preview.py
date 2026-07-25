from pathlib import Path

from PIL import Image

from app.structures.preview import _state_texture, build_preview_payload, write_thumbnail
from app.structures.schematic_reader import ParsedSchematic


def test_simplified_minecraft_materials_distinguish_tree_species_and_rock_types():
    states = [
        "minecraft:oak_log[axis=y]",
        "minecraft:spruce_log[axis=y]",
        "minecraft:birch_log[axis=y]",
        "minecraft:cherry_log[axis=y]",
        "minecraft:oak_leaves[persistent=true]",
        "minecraft:spruce_leaves[persistent=true]",
        "minecraft:cherry_leaves[persistent=true]",
        "minecraft:stone",
        "minecraft:granite",
        "minecraft:diorite",
        "minecraft:tuff",
        "minecraft:mossy_cobblestone",
    ]
    materials = [_state_texture(state) for state in states]

    # The visible top/side combination should remain unique for these common
    # library materials, rather than collapsing all wood, foliage or rock into
    # a single flat colour.
    signatures = {(item["family"], item["top"], item["left"], item["accent"]) for item in materials}
    assert len(signatures) == len(states)


def test_ore_materials_keep_distinct_vein_colours():
    ores = [
        "minecraft:coal_ore",
        "minecraft:iron_ore",
        "minecraft:copper_ore",
        "minecraft:gold_ore",
        "minecraft:redstone_ore",
        "minecraft:lapis_ore",
        "minecraft:diamond_ore",
        "minecraft:emerald_ore",
    ]
    materials = [_state_texture(state) for state in ores]
    assert {item["family"] for item in materials} == {"ore"}
    assert len({item["accent"] for item in materials}) == len(ores)


def test_thumbnail_renderer_writes_a_textured_png(tmp_path: Path):
    blocks = [
        (0, 0, 0, "minecraft:stone"),
        (1, 0, 0, "minecraft:granite"),
        (0, 1, 0, "minecraft:oak_log[axis=y]"),
        (0, 2, 0, "minecraft:oak_leaves[persistent=true]"),
        (1, 1, 0, "minecraft:diamond_ore"),
    ]
    parsed = ParsedSchematic(
        width=2,
        height=3,
        length=1,
        palette={},
        blocks=blocks,
        anchor_x=0,
        anchor_y=0,
        anchor_z=0,
        data_version=0,
    )
    output = tmp_path / "thumbnail.png"
    write_thumbnail(parsed, output, size=160)

    assert output.is_file()
    with Image.open(output) as image:
        assert image.size == (160, 160)
        assert image.mode == "RGB"
        assert len(image.getcolors(maxcolors=100_000) or []) > 20


def test_rotatable_preview_uses_the_same_simplified_material_palette():
    blocks = [
        (0, 0, 0, "minecraft:stone"),
        (1, 0, 0, "minecraft:granite"),
        (0, 1, 0, "minecraft:oak_log[axis=y]"),
        (0, 2, 0, "minecraft:oak_leaves[persistent=true]"),
        (1, 1, 0, "minecraft:diamond_ore"),
    ]
    parsed = ParsedSchematic(
        width=2, height=3, length=1, palette={}, blocks=blocks,
        anchor_x=0, anchor_y=0, anchor_z=0, data_version=0,
    )
    payload = build_preview_payload(parsed)

    assert payload["version"] == 2
    assert len(payload["materials"]) == len(blocks)
    assert all(len(material) == 18 for material in payload["materials"])
    assert all(len(block) == 4 for block in payload["blocks"])
    assert len({tuple(material[:17]) for material in payload["materials"]}) == len(blocks)
