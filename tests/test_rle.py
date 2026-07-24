import numpy as np
import pytest

from app.core.rle import decode_rle_u8, encode_rle_u8


def test_rle_roundtrip():
    source = np.array([0, 0, 1, 1, 1, 255, 2, 2], dtype=np.uint8)
    encoded = encode_rle_u8(source)
    assert encoded == [0, 2, 1, 3, 255, 1, 2, 2]
    assert np.array_equal(decode_rle_u8(encoded, source.size), source)


def test_rle_rejects_wrong_size():
    with pytest.raises(ValueError):
        decode_rle_u8([1, 3], 4)
