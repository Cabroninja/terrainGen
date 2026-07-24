from __future__ import annotations

import gzip
import io
import struct
import time
from pathlib import Path
from typing import Iterable

import numpy as np

TAG_END = 0
TAG_BYTE_ARRAY = 7
TAG_STRING = 8
TAG_LIST = 9
TAG_COMPOUND = 10
TAG_INT = 3
TAG_LONG = 4
TAG_SHORT = 2
TAG_INT_ARRAY = 11


def _name(value: str) -> bytes:
    encoded = value.encode("utf-8")
    return struct.pack(">H", len(encoded)) + encoded


def _header(tag_type: int, name: str) -> bytes:
    return bytes((tag_type,)) + _name(name)


def _write_int(buffer: io.BytesIO, name: str, value: int) -> None:
    buffer.write(_header(TAG_INT, name)); buffer.write(struct.pack(">i", value))


def _write_short(buffer: io.BytesIO, name: str, value: int) -> None:
    buffer.write(_header(TAG_SHORT, name)); buffer.write(struct.pack(">h", value))


def _write_long(buffer: io.BytesIO, name: str, value: int) -> None:
    buffer.write(_header(TAG_LONG, name)); buffer.write(struct.pack(">q", value))


def _write_string(buffer: io.BytesIO, name: str, value: str) -> None:
    encoded = value.encode("utf-8"); buffer.write(_header(TAG_STRING, name)); buffer.write(struct.pack(">H", len(encoded))); buffer.write(encoded)


def _write_int_array(buffer: io.BytesIO, name: str, values: Iterable[int]) -> None:
    values = list(values); buffer.write(_header(TAG_INT_ARRAY, name)); buffer.write(struct.pack(">i", len(values)))
    for value in values: buffer.write(struct.pack(">i", value))


def _write_byte_array(buffer: io.BytesIO, name: str, values: bytes) -> None:
    buffer.write(_header(TAG_BYTE_ARRAY, name)); buffer.write(struct.pack(">i", len(values))); buffer.write(values)


def _empty_compound_list(buffer: io.BytesIO, name: str) -> None:
    buffer.write(_header(TAG_LIST, name)); buffer.write(bytes((TAG_COMPOUND,))); buffer.write(struct.pack(">i", 0))


def _varints(values: np.ndarray) -> bytes:
    array = np.asarray(values, dtype=np.uint32).ravel(order="C")
    if int(array.max(initial=0)) < 128:
        return array.astype(np.uint8, copy=False).tobytes()
    out = bytearray()
    for value in array:
        number = int(value)
        while True:
            byte = number & 0x7F
            number >>= 7
            out.append(byte | (0x80 if number else 0))
            if not number: break
    return bytes(out)


def write_sponge_v3(path: Path, *, width: int, height: int, length: int, palette: dict[str, int], block_data: np.ndarray, data_version: int, name: str) -> None:
    if block_data.size != width * height * length:
        raise ValueError("BlockData no coincide con las dimensiones")
    raw = io.BytesIO(); raw.write(bytes((TAG_COMPOUND,))); raw.write(_name(""))
    raw.write(_header(TAG_COMPOUND, "Schematic")); _write_int(raw, "Version", 3); _write_int(raw, "DataVersion", data_version)
    raw.write(_header(TAG_COMPOUND, "Metadata")); _write_string(raw, "Name", name); _write_string(raw, "Author", "JKR Terrain Generator v2"); _write_long(raw, "Date", int(time.time() * 1000)); raw.write(bytes((TAG_END,)))
    _write_short(raw, "Width", width); _write_short(raw, "Height", height); _write_short(raw, "Length", length); _write_int_array(raw, "Offset", [0, 0, 0])
    raw.write(_header(TAG_COMPOUND, "Blocks")); raw.write(_header(TAG_COMPOUND, "Palette"))
    for state, index in sorted(palette.items(), key=lambda item: item[1]): _write_int(raw, state, index)
    raw.write(bytes((TAG_END,))); _write_byte_array(raw, "Data", _varints(block_data)); _empty_compound_list(raw, "BlockEntities"); raw.write(bytes((TAG_END,)))
    _empty_compound_list(raw, "Entities"); raw.write(bytes((TAG_END,))); raw.write(bytes((TAG_END,)))
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        with gzip.GzipFile(filename="", mode="wb", fileobj=handle, compresslevel=6, mtime=0) as output: output.write(raw.getbuffer())


def write_sponge_v3_streaming(
    path: Path,
    *,
    width: int,
    height: int,
    length: int,
    palette: dict[str, int],
    block_data_length: int,
    block_layers: Iterable[bytes],
    data_version: int,
    name: str,
) -> None:
    """Write a Sponge v3 schematic without allocating the complete voxel volume.

    JKR's current palette uses only one-byte VarInts (< 128), so each yielded
    layer can be written directly to the NBT byte array. This keeps memory usage
    close to one X×Z layer even for very large maps.
    """
    if max(palette.values(), default=0) >= 128:
        raise ValueError("La exportación por capas requiere una paleta menor que 128 estados")
    expected = width * height * length
    if block_data_length != expected:
        raise ValueError("BlockData no coincide con las dimensiones")

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        with gzip.GzipFile(filename="", mode="wb", fileobj=handle, compresslevel=6, mtime=0) as output:
            output.write(bytes((TAG_COMPOUND,))); output.write(_name(""))
            output.write(_header(TAG_COMPOUND, "Schematic")); _write_int(output, "Version", 3); _write_int(output, "DataVersion", data_version)
            output.write(_header(TAG_COMPOUND, "Metadata")); _write_string(output, "Name", name); _write_string(output, "Author", "JKR Terrain Generator v2"); _write_long(output, "Date", int(time.time() * 1000)); output.write(bytes((TAG_END,)))
            _write_short(output, "Width", width); _write_short(output, "Height", height); _write_short(output, "Length", length); _write_int_array(output, "Offset", [0, 0, 0])
            output.write(_header(TAG_COMPOUND, "Blocks")); output.write(_header(TAG_COMPOUND, "Palette"))
            for state, index in sorted(palette.items(), key=lambda item: item[1]): _write_int(output, state, index)
            output.write(bytes((TAG_END,)))
            output.write(_header(TAG_BYTE_ARRAY, "Data")); output.write(struct.pack(">i", block_data_length))
            written = 0
            for chunk in block_layers:
                if not isinstance(chunk, (bytes, bytearray, memoryview)):
                    raise TypeError("Cada capa de BlockData debe entregarse como bytes")
                output.write(chunk); written += len(chunk)
            if written != block_data_length:
                raise ValueError(f"BlockData escribió {written} bytes; se esperaban {block_data_length}")
            _empty_compound_list(output, "BlockEntities"); output.write(bytes((TAG_END,)))
            _empty_compound_list(output, "Entities"); output.write(bytes((TAG_END,))); output.write(bytes((TAG_END,)))
