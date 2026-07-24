from __future__ import annotations

import gzip
import io
import struct
from dataclasses import dataclass

TAG_END = 0
TAG_BYTE = 1
TAG_SHORT = 2
TAG_INT = 3
TAG_LONG = 4
TAG_FLOAT = 5
TAG_DOUBLE = 6
TAG_BYTE_ARRAY = 7
TAG_STRING = 8
TAG_LIST = 9
TAG_COMPOUND = 10
TAG_INT_ARRAY = 11
TAG_LONG_ARRAY = 12


class SchematicReadError(ValueError):
    pass


@dataclass(slots=True)
class ParsedSchematic:
    width: int
    height: int
    length: int
    palette: dict[int, str]
    blocks: list[tuple[int, int, int, str]]
    anchor_x: int
    anchor_y: int
    anchor_z: int
    data_version: int

    @property
    def block_count(self) -> int:
        return len(self.blocks)


def _read_exact(stream: io.BytesIO, size: int) -> bytes:
    data = stream.read(size)
    if len(data) != size:
        raise SchematicReadError("El archivo NBT terminó antes de tiempo.")
    return data


def _u16(stream: io.BytesIO) -> int:
    return struct.unpack(">H", _read_exact(stream, 2))[0]


def _string(stream: io.BytesIO) -> str:
    size = _u16(stream)
    return _read_exact(stream, size).decode("utf-8")


def _payload(stream: io.BytesIO, tag: int):
    if tag == TAG_BYTE:
        return struct.unpack(">b", _read_exact(stream, 1))[0]
    if tag == TAG_SHORT:
        return struct.unpack(">h", _read_exact(stream, 2))[0]
    if tag == TAG_INT:
        return struct.unpack(">i", _read_exact(stream, 4))[0]
    if tag == TAG_LONG:
        return struct.unpack(">q", _read_exact(stream, 8))[0]
    if tag == TAG_FLOAT:
        return struct.unpack(">f", _read_exact(stream, 4))[0]
    if tag == TAG_DOUBLE:
        return struct.unpack(">d", _read_exact(stream, 8))[0]
    if tag == TAG_BYTE_ARRAY:
        size = struct.unpack(">i", _read_exact(stream, 4))[0]
        if size < 0 or size > 200_000_000:
            raise SchematicReadError("ByteArray NBT inválido o demasiado grande.")
        return _read_exact(stream, size)
    if tag == TAG_STRING:
        return _string(stream)
    if tag == TAG_LIST:
        item_type = _read_exact(stream, 1)[0]
        size = struct.unpack(">i", _read_exact(stream, 4))[0]
        if size < 0 or size > 20_000_000:
            raise SchematicReadError("Lista NBT inválida o demasiado grande.")
        return [_payload(stream, item_type) for _ in range(size)]
    if tag == TAG_COMPOUND:
        result = {}
        while True:
            child_type = _read_exact(stream, 1)[0]
            if child_type == TAG_END:
                break
            name = _string(stream)
            result[name] = _payload(stream, child_type)
        return result
    if tag == TAG_INT_ARRAY:
        size = struct.unpack(">i", _read_exact(stream, 4))[0]
        if size < 0 or size > 50_000_000:
            raise SchematicReadError("IntArray NBT inválido o demasiado grande.")
        return list(struct.unpack(f">{size}i", _read_exact(stream, size * 4)))
    if tag == TAG_LONG_ARRAY:
        size = struct.unpack(">i", _read_exact(stream, 4))[0]
        if size < 0 or size > 20_000_000:
            raise SchematicReadError("LongArray NBT inválido o demasiado grande.")
        return list(struct.unpack(f">{size}q", _read_exact(stream, size * 8)))
    raise SchematicReadError(f"Tipo NBT no soportado: {tag}.")


def _read_root(raw: bytes) -> dict:
    try:
        raw = gzip.decompress(raw)
    except (OSError, EOFError):
        pass
    stream = io.BytesIO(raw)
    root_type = _read_exact(stream, 1)[0]
    if root_type != TAG_COMPOUND:
        raise SchematicReadError("El archivo no contiene un compuesto NBT raíz.")
    _string(stream)  # nombre raíz
    value = _payload(stream, TAG_COMPOUND)
    if not isinstance(value, dict):
        raise SchematicReadError("Raíz NBT inválida.")
    return value


def _decode_varints(data: bytes, expected: int) -> list[int]:
    values: list[int] = []
    value = 0
    shift = 0
    for byte in data:
        value |= (byte & 0x7F) << shift
        if byte & 0x80:
            shift += 7
            if shift > 35:
                raise SchematicReadError("VarInt demasiado largo en BlockData.")
            continue
        values.append(value)
        if len(values) > expected:
            raise SchematicReadError("BlockData contiene más bloques que las dimensiones.")
        value = 0
        shift = 0
    if shift:
        raise SchematicReadError("BlockData termina con un VarInt incompleto.")
    if len(values) != expected:
        raise SchematicReadError(f"BlockData contiene {len(values)} bloques; se esperaban {expected}.")
    return values


def _is_air(state: str) -> bool:
    base = state.split("[", 1)[0]
    return base in {"minecraft:air", "minecraft:cave_air", "minecraft:void_air"}


def parse_schematic_bytes(raw: bytes) -> ParsedSchematic:
    if not raw or len(raw) > 25_000_000:
        raise SchematicReadError("El archivo .schem está vacío o supera 25 MB.")
    root = _read_root(raw)
    schematic = root.get("Schematic", root)
    if not isinstance(schematic, dict):
        raise SchematicReadError("No se encontró el compuesto Schematic.")
    version = int(schematic.get("Version", 2))
    width = int(schematic.get("Width", 0))
    height = int(schematic.get("Height", 0))
    length = int(schematic.get("Length", 0))
    if not (1 <= width <= 512 and 1 <= height <= 512 and 1 <= length <= 512):
        raise SchematicReadError("Dimensiones del schematic inválidas o superiores a 512 bloques.")
    total = width * height * length
    if total > 30_000_000:
        raise SchematicReadError("El schematic supera 30 millones de celdas.")

    if version >= 3 and isinstance(schematic.get("Blocks"), dict):
        blocks_tag = schematic["Blocks"]
        palette_raw = blocks_tag.get("Palette")
        block_data = blocks_tag.get("Data")
    else:
        palette_raw = schematic.get("Palette")
        block_data = schematic.get("BlockData")
    if not isinstance(palette_raw, dict) or not isinstance(block_data, (bytes, bytearray)):
        raise SchematicReadError("El schematic no contiene Palette y BlockData compatibles.")
    palette = {int(index): str(state) for state, index in palette_raw.items()}
    values = _decode_varints(bytes(block_data), total)
    blocks: list[tuple[int, int, int, str]] = []
    min_y = height
    for flat, palette_index in enumerate(values):
        state = palette.get(int(palette_index))
        if state is None:
            raise SchematicReadError(f"BlockData usa el índice de paleta desconocido {palette_index}.")
        if _is_air(state):
            continue
        y, remainder = divmod(flat, width * length)
        z, x = divmod(remainder, width)
        blocks.append((x, y, z, state))
        min_y = min(min_y, y)
    if not blocks:
        raise SchematicReadError("El schematic no contiene bloques sólidos.")
    return ParsedSchematic(
        width=width,
        height=height,
        length=length,
        palette=palette,
        blocks=blocks,
        anchor_x=width // 2,
        anchor_y=min_y,
        anchor_z=length // 2,
        data_version=int(schematic.get("DataVersion", 0)),
    )
