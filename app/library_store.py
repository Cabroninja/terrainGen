from __future__ import annotations

import base64
import json
import os
import re
import threading
import uuid
from pathlib import Path
from typing import Any


PRESET_GROUPS = {"brush", "compilation", "mountain"}
_SAFE_NAME = re.compile(r"[^a-zA-Z0-9_.-]+")


class LibraryStore:
    """Persistent, installation-wide library for presets and schematics.

    The browser is only a client. All data is stored under DATA_DIR so every
    computer that opens the same Terrain Generator instance sees one library.
    """

    def __init__(self, root: Path):
        self.root = root
        self.preset_dir = root / "presets"
        self.structure_dir = root / "structures"
        self.structure_file_dir = self.structure_dir / "files"
        self.structure_index_path = self.structure_dir / "index.json"
        self._lock = threading.RLock()
        self.preset_dir.mkdir(parents=True, exist_ok=True)
        self.structure_file_dir.mkdir(parents=True, exist_ok=True)
        if not self.structure_index_path.exists():
            self._write_json(self.structure_index_path, {"version": 1, "collections": [], "assets": []})

    @staticmethod
    def _read_json(path: Path, fallback: Any) -> Any:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return fallback

    @staticmethod
    def _write_json(path: Path, payload: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, path)

    @staticmethod
    def _group(group: str) -> str:
        if group not in PRESET_GROUPS:
            raise ValueError("Grupo de presets no válido")
        return group

    @staticmethod
    def _preset_name(name: str) -> str:
        clean = name.strip()[:40]
        if not clean:
            raise ValueError("El preset necesita un nombre")
        return clean

    def _preset_path(self, group: str) -> Path:
        return self.preset_dir / f"{self._group(group)}.json"

    def list_presets(self, group: str) -> dict[str, dict[str, Any]]:
        with self._lock:
            payload = self._read_json(self._preset_path(group), {})
            return payload if isinstance(payload, dict) else {}

    def save_preset(self, group: str, name: str, values: dict[str, Any]) -> dict[str, Any]:
        group = self._group(group)
        name = self._preset_name(name)
        with self._lock:
            presets = self.list_presets(group)
            presets[name] = values
            self._write_json(self._preset_path(group), presets)
        return {"group": group, "name": name, "values": values}

    def delete_preset(self, group: str, name: str) -> bool:
        group = self._group(group)
        name = self._preset_name(name)
        with self._lock:
            presets = self.list_presets(group)
            existed = name in presets
            presets.pop(name, None)
            self._write_json(self._preset_path(group), presets)
        return existed

    def _load_structure_index(self) -> dict[str, Any]:
        index = self._read_json(self.structure_index_path, {"version": 1, "collections": [], "assets": []})
        if not isinstance(index, dict):
            return {"version": 1, "collections": [], "assets": []}
        index.setdefault("version", 1)
        index.setdefault("collections", [])
        index.setdefault("assets", [])
        return index

    def _save_structure_index(self, index: dict[str, Any]) -> None:
        self._write_json(self.structure_index_path, index)

    def export_structures(self) -> dict[str, Any]:
        """Return project-compatible collections and assets, including content."""
        with self._lock:
            index = self._load_structure_index()
            assets: list[dict[str, Any]] = []
            for metadata in index["assets"]:
                file_key = metadata.get("file_key", "")
                path = self.structure_file_dir / Path(file_key).name
                if not path.is_file():
                    continue
                exported = {key: value for key, value in metadata.items() if key != "file_key"}
                exported["content_b64"] = base64.b64encode(path.read_bytes()).decode("ascii")
                assets.append(exported)
            return {
                "version": 1,
                "structure_collections": index["collections"],
                "structure_assets": assets,
            }

    def create_collection(self, label: str, category: str) -> dict[str, Any]:
        label = label.strip()[:80]
        if not label:
            raise ValueError("La colección necesita un nombre")
        category = "rock" if category == "rock" else "tree"
        collection = {
            "id": f"collection-{uuid.uuid4().hex}",
            "label": label,
            "category": category,
            "members": [],
        }
        with self._lock:
            index = self._load_structure_index()
            index["collections"].append(collection)
            self._save_structure_index(index)
        return collection

    def delete_collection(self, collection_id: str) -> bool:
        with self._lock:
            index = self._load_structure_index()
            target = next((item for item in index["collections"] if item.get("id") == collection_id), None)
            if not target:
                return False
            removed_ids = {item.get("asset_id") for item in target.get("members", [])}
            index["collections"] = [item for item in index["collections"] if item.get("id") != collection_id]
            still_used = {
                member.get("asset_id")
                for collection in index["collections"]
                for member in collection.get("members", [])
            }
            orphaned = removed_ids - still_used
            kept_assets: list[dict[str, Any]] = []
            for asset in index["assets"]:
                if asset.get("id") in orphaned:
                    try:
                        (self.structure_file_dir / Path(asset.get("file_key", "")).name).unlink(missing_ok=True)
                    except OSError:
                        pass
                else:
                    kept_assets.append(asset)
            index["assets"] = kept_assets
            self._save_structure_index(index)
        return True

    def import_asset(self, collection_id: str, filename: str, raw: bytes, parsed: Any) -> tuple[dict[str, Any], dict[str, Any]]:
        with self._lock:
            index = self._load_structure_index()
            collection = next((item for item in index["collections"] if item.get("id") == collection_id), None)
            if not collection:
                raise KeyError("Colección no encontrada")
            asset_id = f"asset-{uuid.uuid4().hex}"
            safe_stem = _SAFE_NAME.sub("-", Path(filename).stem).strip("-_.")[:60] or "estructura"
            file_key = f"{asset_id}-{safe_stem}.schem"
            asset = {
                "id": asset_id,
                "label": Path(filename).stem[:80] or "Estructura",
                "category": collection.get("category", "tree"),
                "filename": Path(filename).name[:160],
                "width": parsed.width,
                "height": parsed.height,
                "length": parsed.length,
                "anchor_x": parsed.anchor_x,
                "anchor_y": parsed.anchor_y,
                "anchor_z": parsed.anchor_z,
                "block_count": parsed.block_count,
                "palette_count": len(parsed.palette),
                "file_key": file_key,
            }
            (self.structure_file_dir / file_key).write_bytes(raw)
            index["assets"].append(asset)
            collection.setdefault("members", []).append({"asset_id": asset_id, "weight": 100})
            self._save_structure_index(index)
            exported = {key: value for key, value in asset.items() if key != "file_key"}
            exported["content_b64"] = base64.b64encode(raw).decode("ascii")
            return exported, collection

    def update_member(self, collection_id: str, asset_id: str, weight: int) -> dict[str, Any]:
        with self._lock:
            index = self._load_structure_index()
            collection = next((item for item in index["collections"] if item.get("id") == collection_id), None)
            if not collection:
                raise KeyError("Colección no encontrada")
            member = next((item for item in collection.get("members", []) if item.get("asset_id") == asset_id), None)
            if not member:
                raise KeyError("Schematic no encontrado en la colección")
            member["weight"] = max(1, min(10_000, int(weight)))
            self._save_structure_index(index)
            return member

    def update_asset(self, asset_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            index = self._load_structure_index()
            asset = next((item for item in index["assets"] if item.get("id") == asset_id), None)
            if not asset:
                raise KeyError("Schematic no encontrado")
            limits = {
                "anchor_x": max(0, int(asset["width"]) - 1),
                "anchor_y": max(0, int(asset["height"]) - 1),
                "anchor_z": max(0, int(asset["length"]) - 1),
            }
            for key, maximum in limits.items():
                if key in patch:
                    asset[key] = max(0, min(maximum, int(patch[key])))
            if "label" in patch:
                label = str(patch["label"]).strip()[:80]
                if label:
                    asset["label"] = label
            self._save_structure_index(index)
            return {key: value for key, value in asset.items() if key != "file_key"}

    def delete_asset(self, collection_id: str, asset_id: str) -> bool:
        with self._lock:
            index = self._load_structure_index()
            collection = next((item for item in index["collections"] if item.get("id") == collection_id), None)
            if not collection:
                return False
            before = len(collection.get("members", []))
            collection["members"] = [item for item in collection.get("members", []) if item.get("asset_id") != asset_id]
            if len(collection["members"]) == before:
                return False
            still_used = any(
                any(member.get("asset_id") == asset_id for member in item.get("members", []))
                for item in index["collections"]
            )
            if not still_used:
                asset = next((item for item in index["assets"] if item.get("id") == asset_id), None)
                if asset:
                    try:
                        (self.structure_file_dir / Path(asset.get("file_key", "")).name).unlink(missing_ok=True)
                    except OSError:
                        pass
                index["assets"] = [item for item in index["assets"] if item.get("id") != asset_id]
            self._save_structure_index(index)
        return True
