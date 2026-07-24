from __future__ import annotations

from collections.abc import Iterable

import numpy as np


def decode_rle_u8(data: list[int], expected_size: int) -> np.ndarray:
    """Decode [value, count, ...] into a flat uint8 array."""
    if len(data) < 2 or len(data) % 2:
        raise ValueError("La capa RLE debe contener pares valor/cantidad")
    values = np.asarray(data[0::2], dtype=np.int64)
    counts = np.asarray(data[1::2], dtype=np.int64)
    if np.any(values < 0) or np.any(values > 255):
        raise ValueError("Los valores RLE deben estar entre 0 y 255")
    if np.any(counts <= 0):
        raise ValueError("Cada repetición RLE debe ser mayor que cero")
    total = int(counts.sum())
    if total != expected_size:
        raise ValueError(f"La capa RLE ocupa {total} celdas y se esperaban {expected_size}")
    return np.repeat(values.astype(np.uint8), counts).astype(np.uint8, copy=False)


def encode_rle_u8(values: np.ndarray | Iterable[int]) -> list[int]:
    array = np.asarray(list(values) if not isinstance(values, np.ndarray) else values, dtype=np.uint8).ravel()
    if array.size == 0:
        return []
    changes = np.flatnonzero(array[1:] != array[:-1]) + 1
    starts = np.concatenate(([0], changes))
    ends = np.concatenate((changes, [array.size]))
    output: list[int] = []
    for start, end in zip(starts, ends, strict=True):
        output.extend((int(array[start]), int(end - start)))
    return output
