from fastapi.testclient import TestClient

from app.main import app
from tests.helpers import project_payload


def test_health_and_preview_compile():
    client = TestClient(app)
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["architecture"] == "paint-first"
    assert health.json()["version"] == "5.6.1"

    response = client.post("/api/compile", json={"project": project_payload(), "export_schematic": False})
    assert response.status_code == 200
    body = response.json()
    assert {"preview", "heightmap", "slope", "walkability", "terrain3d", "voxel3d", "validation", "metadata"} <= body["files"].keys()


def test_compile_terrain3d_payload():
    client = TestClient(app)
    response = client.post("/api/compile", json={"project": project_payload(), "export_schematic": False})
    assert response.status_code == 200
    terrain_url = response.json()["files"]["terrain3d"]
    terrain_response = client.get(terrain_url)
    assert terrain_response.status_code == 200
    payload = terrain_response.json()
    assert payload["format"] == "jkr-terrain-preview-3d"
    assert payload["version"] == 2
    assert len(payload["height"]) == payload["width"] * payload["length"]
    assert len(payload["material"]) == len(payload["height"])
    assert len(payload["mountain"]) == len(payload["height"])
    assert len(payload["exit_corridors"]) == len(payload["height"])
    assert payload["width"] <= 161
    assert payload["length"] <= 161


def test_voxel_manifest_and_chunk_are_available():
    client = TestClient(app)
    response = client.post("/api/compile", json={"project": project_payload(), "export_schematic": False})
    assert response.status_code == 200
    body = response.json()
    manifest_response = client.get(body["files"]["voxel3d"])
    assert manifest_response.status_code == 200
    manifest = manifest_response.json()
    assert manifest["format"] == "jkr-voxel-preview"
    assert manifest["source"] == "same-block-rules-as-schematic"
    assert manifest["controls"]["maximum_render_distance"] == 16
    chunk_url = manifest["chunk_url"].replace("{x}", "0").replace("{z}", "0")
    chunk_response = client.get(chunk_url)
    assert chunk_response.status_code == 200
    chunk = chunk_response.json()
    assert chunk["format"] == "jkr-voxel-chunk"
    assert chunk["core_width"] == 16
    assert len(chunk["height"]) == chunk["width"] * chunk["length"]
    assert len(chunk["top_block"]) == len(chunk["height"])
    assert set(chunk["top_block"]) == {4}
