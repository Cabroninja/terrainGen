from __future__ import annotations

from fastapi.testclient import TestClient

import app.main as main_module
from app.library_store import LibraryStore
from tests.test_structures import tiny_tree_bytes


def test_server_preset_library_crud(tmp_path, monkeypatch):
    monkeypatch.setattr(main_module, "LIBRARY", LibraryStore(tmp_path / "library"))
    client = TestClient(main_module.app)

    empty = client.get("/api/library/presets/brush")
    assert empty.status_code == 200
    assert empty.json()["presets"] == {}

    saved = client.put(
        "/api/library/presets/brush/Meseta%20suave",
        json={"values": {"plateau-radius": "22", "plateau-support-enabled": True}},
    )
    assert saved.status_code == 200
    assert saved.json()["name"] == "Meseta suave"

    listed = client.get("/api/library/presets/brush").json()["presets"]
    assert listed["Meseta suave"]["plateau-radius"] == "22"

    deleted = client.delete("/api/library/presets/brush/Meseta%20suave")
    assert deleted.status_code == 200
    assert client.get("/api/library/presets/brush").json()["presets"] == {}



def test_brush_presets_are_isolated_by_tool_scope(tmp_path, monkeypatch):
    monkeypatch.setattr(main_module, "LIBRARY", LibraryStore(tmp_path / "library"))
    client = TestClient(main_module.app)

    river = client.put(
        "/api/library/presets/brush/Natural?scope=water.river",
        json={"values": {"water-width": "12", "water-depth": "3"}},
    )
    plateau = client.put(
        "/api/library/presets/brush/Natural?scope=height_base.plateau",
        json={"values": {"plateau-height": "84", "plateau-radius": "20"}},
    )
    assert river.status_code == 200
    assert plateau.status_code == 200

    river_presets = client.get("/api/library/presets/brush?scope=water.river").json()["presets"]
    plateau_presets = client.get("/api/library/presets/brush?scope=height_base.plateau").json()["presets"]
    mass_presets = client.get("/api/library/presets/brush?scope=water.mass.paint").json()["presets"]

    assert river_presets == {"Natural": {"water-width": "12", "water-depth": "3"}}
    assert plateau_presets == {"Natural": {"plateau-height": "84", "plateau-radius": "20"}}
    assert mass_presets == {}

    deleted = client.delete("/api/library/presets/brush/Natural?scope=water.river")
    assert deleted.status_code == 200
    assert client.get("/api/library/presets/brush?scope=water.river").json()["presets"] == {}
    assert "Natural" in client.get("/api/library/presets/brush?scope=height_base.plateau").json()["presets"]


def test_invalid_brush_preset_scope_is_rejected(tmp_path, monkeypatch):
    monkeypatch.setattr(main_module, "LIBRARY", LibraryStore(tmp_path / "library"))
    client = TestClient(main_module.app)
    response = client.get("/api/library/presets/brush?scope=water/../../outside")
    assert response.status_code == 404

def test_server_structure_library_persists_schematic_and_metadata(tmp_path, monkeypatch):
    store_root = tmp_path / "library"
    monkeypatch.setattr(main_module, "LIBRARY", LibraryStore(store_root))
    client = TestClient(main_module.app)

    created = client.post(
        "/api/library/structures/collections",
        json={"label": "Bosque compartido", "category": "tree"},
    )
    assert created.status_code == 200
    collection_id = created.json()["id"]

    raw = tiny_tree_bytes(tmp_path)
    imported = client.post(
        f"/api/library/structures/collections/{collection_id}/assets",
        files={"file": ("tiny_tree.schem", raw, "application/octet-stream")},
    )
    assert imported.status_code == 200
    asset_id = imported.json()["asset"]["id"]

    update_weight = client.patch(
        f"/api/library/structures/collections/{collection_id}/members/{asset_id}",
        json={"weight": 275},
    )
    assert update_weight.status_code == 200

    # A fresh store instance simulates another process/computer reading the
    # same persistent DATA_DIR volume.
    monkeypatch.setattr(main_module, "LIBRARY", LibraryStore(store_root))
    library = client.get("/api/library/structures")
    assert library.status_code == 200
    payload = library.json()
    assert payload["structure_collections"][0]["members"][0]["weight"] == 275
    assert payload["structure_assets"][0]["content_b64"]


def test_structure_library_visual_manager_endpoints(tmp_path, monkeypatch):
    store_root = tmp_path / "library"
    monkeypatch.setattr(main_module, "LIBRARY", LibraryStore(store_root))
    client = TestClient(main_module.app)

    trees = client.post("/api/library/structures/collections", json={"label": "Robles", "category": "tree"}).json()
    rocks = client.post("/api/library/structures/collections", json={"label": "Rocas medianas", "category": "rock"}).json()
    raw = tiny_tree_bytes(tmp_path)
    imported = client.post(
        f"/api/library/structures/collections/{trees['id']}/assets",
        files={"file": ("tree_preview.schem", raw, "application/octet-stream")},
    )
    assert imported.status_code == 200
    asset = imported.json()["asset"]
    assert asset["thumbnail_url"].endswith("/thumbnail")
    assert asset["preview_url"].endswith("/preview")

    thumbnail = client.get(asset["thumbnail_url"])
    assert thumbnail.status_code == 200
    assert thumbnail.headers["content-type"].startswith("image/png")
    assert thumbnail.content.startswith(b"\x89PNG")

    preview = client.get(asset["preview_url"])
    assert preview.status_code == 200
    preview_payload = preview.json()
    assert preview_payload["format"] == "jkr-schematic-preview"
    assert preview_payload["blocks"]

    renamed = client.patch(
        f"/api/library/structures/collections/{trees['id']}",
        json={"label": "Bosque de robles"},
    )
    assert renamed.status_code == 200
    assert renamed.json()["label"] == "Bosque de robles"

    moved = client.post(
        f"/api/library/structures/collections/{trees['id']}/move-assets",
        json={"target_collection_id": rocks["id"], "asset_ids": [asset["id"]]},
    )
    assert moved.status_code == 200
    assert moved.json()["moved"] == [asset["id"]]
    assert moved.json()["source"]["members"] == []
    assert moved.json()["target"]["members"][0]["asset_id"] == asset["id"]
