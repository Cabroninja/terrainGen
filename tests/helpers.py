from __future__ import annotations

from app.core.models import ProjectDocument


def rle(value: int, count: int) -> dict:
    return {"encoding": "rle-u8", "data": [value, count]}


def project_payload(width: int = 64, length: int = 64, height: int = 96) -> dict:
    total = width * length
    layers = {
        "playable": rle(255, total),
        "regions": rle(1, total),
        "roads": rle(0, total),
        "height_base": rle(128, total),
        "height_modifier": rle(128, total),
        "water": rle(0, total),
        "reserved": rle(0, total),
        "materials": rle(0, total),
        "exclusion": rle(0, total),
    }
    return {
        "format": "jkr-terrain-project",
        "version": 2,
        "config": {
            "name": "test_map",
            "width": width,
            "length": length,
            "schematic_height": height,
            "min_height": 10,
            "max_height": 70,
            "sea_level": 30,
        },
        "layers": layers,
        "markers": [],
    }


def make_project(**kwargs) -> ProjectDocument:
    return ProjectDocument.model_validate(project_payload(**kwargs))
