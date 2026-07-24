import pytest
from pydantic import ValidationError

from app.core.models import ProjectDocument
from tests.helpers import project_payload


def test_rectangular_dimensions_are_supported():
    project = ProjectDocument.model_validate(project_payload(width=128, length=256, height=128))
    assert project.config.width == 128
    assert project.config.length == 256


def test_dimensions_must_be_chunk_aligned():
    payload = project_payload()
    payload["config"]["width"] = 70
    with pytest.raises(ValidationError):
        ProjectDocument.model_validate(payload)


def test_vertical_order_is_validated():
    payload = project_payload()
    payload["config"]["sea_level"] = 75
    with pytest.raises(ValidationError):
        ProjectDocument.model_validate(payload)


def test_mountain_settings_are_validated():
    payload = project_payload()
    payload["config"]["mountain_outer_width"] = 600
    with pytest.raises(ValidationError):
        ProjectDocument.model_validate(payload)


def test_large_and_small_chunk_aligned_dimensions_are_supported():
    small = ProjectDocument.model_validate(project_payload(width=32, length=48, height=96))
    large = ProjectDocument.model_validate(project_payload(width=2048, length=1024, height=96))
    assert (small.config.width, small.config.length) == (32, 48)
    assert (large.config.width, large.config.length) == (2048, 1024)


def test_dimensions_above_new_limit_are_rejected():
    payload = project_payload()
    payload["config"]["width"] = 2064
    with pytest.raises(ValidationError):
        ProjectDocument.model_validate(payload)
