from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

LAYER_NAMES = (
    "playable",
    "regions",
    "roads",
    "height_base",
    "height_modifier",
    "water",
    "reserved",
    "materials",
    "exclusion",
)


class ProjectConfig(BaseModel):
    name: str = Field(default="mapa_albion", min_length=1, max_length=60, pattern=r"^[a-zA-Z0-9_-]+$")
    width: int = Field(default=256, ge=32, le=2048)
    length: int = Field(default=256, ge=32, le=2048)
    schematic_height: int = Field(default=160, ge=64, le=320)
    min_height: int = Field(default=18, ge=2, le=160)
    max_height: int = Field(default=120, ge=12, le=300)
    sea_level: int = Field(default=46, ge=4, le=250)
    height_modifier_range: int = Field(default=32, ge=4, le=128)
    road_fit_width: int = Field(default=0, ge=0, le=128, description="Obsoleto: ya no altera el relieve")
    reserved_fit_width: int = Field(default=0, ge=0, le=128, description="Obsoleto: ya no altera el relieve")
    shore_width: int = Field(default=5, ge=0, le=128)
    water_depth: int = Field(default=3, ge=1, le=32)
    water_shore_profile: Literal["compact", "natural", "smooth"] = "natural"
    water_road_policy: Literal["protect", "ford", "cut"] = "protect"
    max_walk_slope: float = Field(default=1.75, ge=0.25, le=8.0)
    surface_depth: int = Field(default=4, ge=1, le=16)
    data_version: int = Field(default=4189, ge=0, le=100_000)
    seed: int = Field(default=123456, ge=0, le=2_147_483_647)
    mountain_border_enabled: bool = False
    mountain_outer_width: int = Field(default=32, ge=4, le=512)
    mountain_inner_transition: int = Field(default=18, ge=2, le=512)
    mountain_height: int = Field(default=38, ge=4, le=240)
    mountain_irregularity: int = Field(default=45, ge=0, le=100)
    mountain_roughness: int = Field(default=35, ge=0, le=100)
    mountain_exit_width: int = Field(default=14, ge=4, le=256)
    mountain_exit_transition: int = Field(default=36, ge=4, le=512)
    max_voxels: int = Field(default=750_000_000, ge=1_000_000, le=1_000_000_000)

    @model_validator(mode="after")
    def validate_dimensions(self) -> "ProjectConfig":
        if self.width % 16 or self.length % 16:
            raise ValueError("Ancho y largo deben ser múltiplos de 16")
        if self.min_height >= self.max_height:
            raise ValueError("La altura mínima debe ser menor que la máxima")
        if self.max_height >= self.schematic_height:
            raise ValueError("La altura máxima debe quedar dentro de la altura del schematic")
        if not self.min_height < self.sea_level < self.max_height:
            raise ValueError("El nivel del agua debe quedar entre la altura mínima y máxima")
        return self


class RleLayer(BaseModel):
    encoding: Literal["rle-u8"] = "rle-u8"
    data: list[int] = Field(min_length=2, max_length=8_400_000)


class Marker(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["spawn", "exit", "poi"]
    x: int = Field(ge=0)
    z: int = Field(ge=0)
    label: str = Field(default="", max_length=80)
    radius: int = Field(default=10, ge=1, le=512)


class RoadRampPoint(BaseModel):
    x: float = Field(ge=0)
    z: float = Field(ge=0)


class RoadRamp(BaseModel):
    kind: Literal["road", "terrain"] = "road"
    id: str = Field(min_length=1, max_length=64)
    label: str = Field(default="", max_length=80)
    road_type: Literal["primary", "secondary"] = "primary"
    points: list[RoadRampPoint] = Field(min_length=2, max_length=64)
    width: int = Field(default=7, ge=1, le=64)
    shoulder_width: int = Field(default=5, ge=0, le=64)
    slope_ratio: float = Field(default=3.0, ge=1.0, le=12.0)
    start_landing: int = Field(default=4, ge=0, le=64)
    end_landing: int = Field(default=5, ge=0, le=64)
    smooth_sides: bool = False
    side_slope_ratio: float = Field(default=2.0, ge=0.5, le=8.0)
    max_side_width: int = Field(default=24, ge=1, le=128)
    side_roundness: int = Field(default=65, ge=0, le=100)
    follow_terrain: bool = True


class WaterCoursePoint(BaseModel):
    x: float = Field(ge=0)
    z: float = Field(ge=0)


class WaterCourse(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    label: str = Field(default="", max_length=80)
    points: list[WaterCoursePoint] = Field(min_length=2, max_length=512)
    width: int = Field(default=9, ge=1, le=128)
    depth: int = Field(default=3, ge=1, le=32)
    shore_width: int = Field(default=6, ge=0, le=128)
    shore_profile: Literal["compact", "natural", "smooth"] = "natural"
    road_policy: Literal["protect", "ford", "cut"] = "protect"
    river_style: Literal["calm", "natural", "mountain"] = "natural"
    cascade_incline_ratio: float = Field(default=0.0, ge=0.0, le=12.0)
    # Campos heredados de las versiones 5.1–5.2.5. Se conservan únicamente
    # para abrir proyectos antiguos; el generador automático ya no los usa.
    relief_mode: Literal["downhill", "follow"] = "downhill"
    cascade_containment: bool = False
    cascade_threshold: int = Field(default=2, ge=2, le=16)
    downhill_slope_ratio: float = Field(default=4.0, ge=1.0, le=12.0)
    smoothing: int = Field(default=60, ge=0, le=100)
    exit_enabled: bool = False


class StructureCollectionMember(BaseModel):
    asset_id: str = Field(min_length=1, max_length=64)
    weight: int = Field(default=100, ge=1, le=10_000)


class StructureAsset(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    label: str = Field(default="", max_length=80)
    category: Literal["tree", "rock"] = "tree"
    filename: str = Field(default="", max_length=160)
    width: int = Field(ge=1, le=512)
    height: int = Field(ge=1, le=512)
    length: int = Field(ge=1, le=512)
    anchor_x: int = Field(ge=0, le=511)
    anchor_y: int = Field(ge=0, le=511)
    anchor_z: int = Field(ge=0, le=511)
    block_count: int = Field(default=0, ge=1, le=30_000_000)
    palette_count: int = Field(default=0, ge=1, le=32_768)
    content_b64: str = Field(min_length=4, max_length=40_000_000)


class StructureCollection(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=80)
    category: Literal["tree", "rock"] = "tree"
    members: list[StructureCollectionMember] = Field(default_factory=list, max_length=512)


class StructurePlacement(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    collection_id: str = Field(min_length=1, max_length=64)
    asset_id: str = Field(min_length=1, max_length=64)
    x: int = Field(ge=0)
    z: int = Field(ge=0)
    rotation: Literal[0, 90, 180, 270] = 0
    mirror: bool = False
    sink: int = Field(default=0, ge=0, le=32)


class ReferenceImage(BaseModel):
    name: str = Field(default="referencia", max_length=160)
    data_url: str = Field(min_length=32, max_length=30_000_000, pattern=r"^data:image/(png|jpeg|webp);base64,")
    x: float = Field(default=0.0, ge=-8192.0, le=8192.0)
    z: float = Field(default=0.0, ge=-8192.0, le=8192.0)
    fit_width: float = Field(default=1.0, gt=0.0, le=8192.0)
    fit_height: float = Field(default=1.0, gt=0.0, le=8192.0)
    scale: float = Field(default=1.0, ge=0.1, le=5.0)
    rotation: float = Field(default=0.0, ge=-180.0, le=180.0)
    opacity: float = Field(default=0.4, ge=0.0, le=1.0)
    visible: bool = True
    locked: bool = False


class ProjectDocument(BaseModel):
    format: Literal["jkr-terrain-project"] = "jkr-terrain-project"
    version: Literal[2] = 2
    config: ProjectConfig
    layers: dict[str, RleLayer]
    markers: list[Marker] = Field(default_factory=list, max_length=256)
    road_ramps: list[RoadRamp] = Field(default_factory=list, max_length=128)
    water_courses: list[WaterCourse] = Field(default_factory=list, max_length=128)
    structure_assets: list[StructureAsset] = Field(default_factory=list, max_length=2048)
    structure_collections: list[StructureCollection] = Field(default_factory=list, max_length=512)
    structure_placements: list[StructurePlacement] = Field(default_factory=list, max_length=100_000)
    reference_image: ReferenceImage | None = None

    @model_validator(mode="after")
    def validate_project(self) -> "ProjectDocument":
        missing = [name for name in LAYER_NAMES if name not in self.layers]
        if missing:
            raise ValueError(f"Faltan capas obligatorias: {', '.join(missing)}")
        expected = self.config.width * self.config.length
        for name in LAYER_NAMES:
            layer = self.layers[name]
            total = 0
            if len(layer.data) % 2:
                raise ValueError(f"La capa {name} contiene un RLE incompleto")
            for index in range(0, len(layer.data), 2):
                value, count = layer.data[index], layer.data[index + 1]
                if not 0 <= value <= 255 or count <= 0:
                    raise ValueError(f"La capa {name} contiene un par RLE inválido")
                total += count
            if total != expected:
                raise ValueError(f"La capa {name} no coincide con {self.config.width}×{self.config.length}")
        for marker in self.markers:
            if marker.x >= self.config.width or marker.z >= self.config.length:
                raise ValueError(f"El marcador {marker.id} está fuera del mapa")
        for ramp in self.road_ramps:
            for point in ramp.points:
                if point.x >= self.config.width or point.z >= self.config.length:
                    raise ValueError(f"La rampa {'de meseta' if ramp.kind == 'terrain' else 'vial'} {ramp.id} contiene un punto fuera del mapa")
        for course in self.water_courses:
            for point in course.points:
                if point.x >= self.config.width or point.z >= self.config.length:
                    raise ValueError(f"El curso de agua {course.id} contiene un punto fuera del mapa")
        asset_ids = {item.id for item in self.structure_assets}
        if len(asset_ids) != len(self.structure_assets):
            raise ValueError("Hay assets de estructura con ID repetido")
        collection_ids = {item.id for item in self.structure_collections}
        if len(collection_ids) != len(self.structure_collections):
            raise ValueError("Hay colecciones de estructura con ID repetido")
        for asset in self.structure_assets:
            if asset.anchor_x >= asset.width or asset.anchor_y >= asset.height or asset.anchor_z >= asset.length:
                raise ValueError(f"El punto de apoyo de {asset.label or asset.id} está fuera de sus dimensiones")
        for collection in self.structure_collections:
            for member in collection.members:
                if member.asset_id not in asset_ids:
                    raise ValueError(f"La colección {collection.label} referencia el asset inexistente {member.asset_id}")
        for placement in self.structure_placements:
            if placement.asset_id not in asset_ids:
                raise ValueError(f"La instancia {placement.id} referencia un asset inexistente")
            if placement.collection_id not in collection_ids:
                raise ValueError(f"La instancia {placement.id} referencia una colección inexistente")
            if placement.x >= self.config.width or placement.z >= self.config.length:
                raise ValueError(f"La instancia {placement.id} está fuera del mapa")
        return self


class LibraryPresetPayload(BaseModel):
    values: dict[str, str | int | float | bool | None] = Field(default_factory=dict, max_length=256)


class LibraryCollectionCreate(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    category: Literal["tree", "rock"] = "tree"


class LibraryCollectionUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=80)
    category: Literal["tree", "rock"] | None = None


class LibraryAssetsMove(BaseModel):
    target_collection_id: str = Field(min_length=1, max_length=120)
    asset_ids: list[str] = Field(min_length=1, max_length=500)


class LibraryMemberUpdate(BaseModel):
    weight: int = Field(default=100, ge=1, le=10_000)


class LibraryAssetUpdate(BaseModel):
    label: str | None = Field(default=None, max_length=80)
    anchor_x: int | None = Field(default=None, ge=0, le=511)
    anchor_y: int | None = Field(default=None, ge=0, le=511)
    anchor_z: int | None = Field(default=None, ge=0, le=511)


class CompileRequest(BaseModel):
    project: ProjectDocument
    export_schematic: bool = False
