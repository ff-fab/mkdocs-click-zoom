"""Shared fixtures for mkdocs-click-zoom tests."""

from __future__ import annotations

from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture()
def minimal_site() -> Path:
    """Return path to the minimal MkDocs test site."""
    return FIXTURES_DIR / "minimal-site"
