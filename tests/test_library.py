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
