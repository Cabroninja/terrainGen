from __future__ import annotations

import base64
import json
import os
import shutil
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.core.models import (
    CompileRequest, LibraryAssetUpdate, LibraryCollectionCreate,
    LibraryMemberUpdate, LibraryPresetPayload,
)
from app.exporters import read_voxel_chunk, write_preview_images, write_schematic, write_terrain_3d_data, write_voxel_source
from app.terrain import compile_project
from app.structures import parse_schematic_bytes
from app.library_store import LibraryStore

BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", BASE_DIR / "output"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
LIBRARY = LibraryStore(DATA_DIR / "library")

app = FastAPI(title="JKR Terrain Generator", version="5.0.0")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "version": "5.0.0", "architecture": "paint-first", "library": "server"}


@app.post("/api/structures/import")
async def import_structure(file: UploadFile = File(...)) -> dict:
    filename = Path(file.filename or "estructura.schem").name
    if not filename.lower().endswith(".schem"):
        raise HTTPException(status_code=422, detail="Solo se admiten archivos .schem Sponge v2/v3.")
    raw = await file.read()
    try:
        parsed = parse_schematic_bytes(raw)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "filename": filename,
        "label": Path(filename).stem[:80],
        "width": parsed.width,
        "height": parsed.height,
        "length": parsed.length,
        "anchor_x": parsed.anchor_x,
        "anchor_y": parsed.anchor_y,
        "anchor_z": parsed.anchor_z,
        "block_count": parsed.block_count,
        "palette_count": len(parsed.palette),
        "data_version": parsed.data_version,
        "content_b64": base64.b64encode(raw).decode("ascii"),
    }


@app.get("/api/library/presets/{group}")
def list_library_presets(group: str) -> dict:
    try:
        return {"group": group, "presets": LIBRARY.list_presets(group)}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.put("/api/library/presets/{group}/{name}")
def save_library_preset(group: str, name: str, payload: LibraryPresetPayload) -> dict:
    try:
        return LIBRARY.save_preset(group, name, payload.values)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.delete("/api/library/presets/{group}/{name}")
def delete_library_preset(group: str, name: str) -> dict:
    try:
        deleted = LIBRARY.delete_preset(group, name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Preset no encontrado")
    return {"deleted": True, "group": group, "name": name}


@app.get("/api/library/structures")
def get_structure_library() -> dict:
    return LIBRARY.export_structures()


@app.post("/api/library/structures/collections")
def create_library_collection(payload: LibraryCollectionCreate) -> dict:
    try:
        return LIBRARY.create_collection(payload.label, payload.category)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.delete("/api/library/structures/collections/{collection_id}")
def delete_library_collection(collection_id: str) -> dict:
    if not LIBRARY.delete_collection(collection_id):
        raise HTTPException(status_code=404, detail="Colección no encontrada")
    return {"deleted": True, "collection_id": collection_id}


@app.post("/api/library/structures/collections/{collection_id}/assets")
async def import_library_asset(collection_id: str, file: UploadFile = File(...)) -> dict:
    filename = Path(file.filename or "estructura.schem").name
    if not filename.lower().endswith(".schem"):
        raise HTTPException(status_code=422, detail="Solo se admiten archivos .schem Sponge v2/v3.")
    raw = await file.read()
    try:
        parsed = parse_schematic_bytes(raw)
        asset, collection = LIBRARY.import_asset(collection_id, filename, raw, parsed)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc).strip("'")) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"asset": asset, "collection": collection}


@app.patch("/api/library/structures/collections/{collection_id}/members/{asset_id}")
def update_library_member(collection_id: str, asset_id: str, payload: LibraryMemberUpdate) -> dict:
    try:
        return LIBRARY.update_member(collection_id, asset_id, payload.weight)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc).strip("'")) from exc


@app.patch("/api/library/structures/assets/{asset_id}")
def update_library_asset(asset_id: str, payload: LibraryAssetUpdate) -> dict:
    try:
        return LIBRARY.update_asset(asset_id, payload.model_dump(exclude_none=True))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc).strip("'")) from exc


@app.delete("/api/library/structures/collections/{collection_id}/assets/{asset_id}")
def delete_library_asset(collection_id: str, asset_id: str) -> dict:
    if not LIBRARY.delete_asset(collection_id, asset_id):
        raise HTTPException(status_code=404, detail="Schematic no encontrado")
    return {"deleted": True, "collection_id": collection_id, "asset_id": asset_id}


@app.post("/api/validate")
def validate_project(request: CompileRequest) -> dict:
    terrain = compile_project(request.project)
    return terrain.validation


@app.post("/api/compile")
def compile_endpoint(request: CompileRequest) -> dict:
    project = request.project
    terrain = compile_project(project)
    job_id = uuid.uuid4().hex
    output_dir = OUTPUT_DIR / job_id
    output_dir.mkdir(parents=True, exist_ok=False)
    files = write_preview_images(output_dir, project.config, terrain)
    files["terrain3d"] = write_terrain_3d_data(output_dir, project.config, terrain)
    files["voxel3d"] = write_voxel_source(output_dir, project.config, terrain, job_id=job_id)
    validation_name = f"{project.config.name}_validation.json"
    metadata_name = f"{project.config.name}_metadata.json"
    (output_dir / validation_name).write_text(json.dumps(terrain.validation, ensure_ascii=False, indent=2), encoding="utf-8")
    (output_dir / metadata_name).write_text(json.dumps({
        "format": "jkr-terrain-compiled",
        "version": 2,
        "config": project.config.model_dump(),
        "markers": terrain.markers,
        "road_ramps": [item.model_dump() for item in project.road_ramps],
        "water_courses": [item.model_dump() for item in project.water_courses],
        "structure_collections": [item.model_dump() for item in project.structure_collections],
        "structure_instances": len(project.structure_placements),
        "validation": terrain.validation,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    files["validation"] = validation_name
    files["metadata"] = metadata_name
    if request.export_schematic:
        schematic_name = f"{project.config.name}.schem"
        try:
            write_schematic(output_dir / schematic_name, project.config, terrain)
        except ValueError as exc:
            shutil.rmtree(output_dir, ignore_errors=True)
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        files["schematic"] = schematic_name
    return {
        "job_id": job_id,
        "validation": terrain.validation,
        "files": {key: f"/api/files/{job_id}/{name}" for key, name in files.items()},
    }


@app.get("/api/voxel/{job_id}/{chunk_x}/{chunk_z}")
def get_voxel_chunk(job_id: str, chunk_x: int, chunk_z: int) -> dict:
    safe_job = "".join(char for char in job_id if char.isalnum())
    output_dir = OUTPUT_DIR / safe_job
    if not output_dir.is_dir():
        raise HTTPException(status_code=404, detail="Compilación no encontrada")
    try:
        return read_voxel_chunk(output_dir, chunk_x, chunk_z)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except IndexError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

@app.get("/api/files/{job_id}/{filename}")
def get_file(job_id: str, filename: str):
    safe_job = "".join(char for char in job_id if char.isalnum())
    safe_name = Path(filename).name
    path = OUTPUT_DIR / safe_job / safe_name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    media = "application/octet-stream"
    if safe_name.endswith(".png"): media = "image/png"
    elif safe_name.endswith(".json"): media = "application/json"
    return FileResponse(path, media_type=media, filename=None if safe_name.endswith(".png") else safe_name)


STATIC_DIR = BASE_DIR / "app" / "static"
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
