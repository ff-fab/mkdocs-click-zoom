"""Tests for the ClickZoomPlugin."""

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from mkdocs_click_zoom.plugin import ASSETS_DIR, ClickZoomPlugin


class TestOnConfig:
    """Tests for the on_config hook."""

    def _make_config(self) -> MagicMock:
        config = MagicMock()
        store: dict[str, list] = {
            "extra_css": [],
            "extra_javascript": [],
        }
        config.__getitem__ = MagicMock(side_effect=lambda k: store[k])
        return config

    def test_registers_assets(self) -> None:
        plugin = ClickZoomPlugin()
        plugin.config = {"enabled": True, "selectors": [".mermaid"]}
        config = self._make_config()

        result = plugin.on_config(config)

        assert "assets/click-zoom/click-zoom.css" in config["extra_css"]
        assert "assets/click-zoom/click-zoom.js" in config["extra_javascript"]

    def test_js_inserted_at_front(self) -> None:
        plugin = ClickZoomPlugin()
        plugin.config = {"enabled": True, "selectors": [".mermaid"]}
        config = self._make_config()
        config["extra_javascript"].append("existing.js")

        plugin.on_config(config)

        assert config["extra_javascript"][0] == "assets/click-zoom/click-zoom.js"

    def test_disabled_skips_registration(self) -> None:
        plugin = ClickZoomPlugin()
        plugin.config = {"enabled": False, "selectors": [".mermaid"]}
        config = self._make_config()

        plugin.on_config(config)

        assert len(config["extra_css"]) == 0
        assert len(config["extra_javascript"]) == 0

    def test_no_duplicate_registration(self) -> None:
        plugin = ClickZoomPlugin()
        plugin.config = {"enabled": True, "selectors": [".mermaid"]}
        config = self._make_config()

        plugin.on_config(config)
        plugin.on_config(config)

        assert config["extra_css"].count("assets/click-zoom/click-zoom.css") == 1
        assert config["extra_javascript"].count("assets/click-zoom/click-zoom.js") == 1


class TestOnPostBuild:
    """Tests for the on_post_build hook."""

    def test_copies_assets(self, tmp_path: Path) -> None:
        plugin = ClickZoomPlugin()
        plugin.config = {
            "enabled": True,
            "selectors": [".mermaid", "article svg"],
        }
        config = MagicMock()
        config.__getitem__ = MagicMock(
            side_effect=lambda k: {
                "site_dir": str(tmp_path),
                "extra_javascript": [],
            }[k]
        )

        plugin.on_post_build(config)

        output_dir = tmp_path / "assets" / "click-zoom"
        assert (output_dir / "click-zoom.css").exists()
        assert (output_dir / "click-zoom.js").exists()
        assert (output_dir / "click-zoom-config.js").exists()

    def test_config_js_contains_selectors(self, tmp_path: Path) -> None:
        plugin = ClickZoomPlugin()
        plugin.config = {
            "enabled": True,
            "selectors": [".mermaid", ".custom-svg"],
        }
        config = MagicMock()
        config.__getitem__ = MagicMock(
            side_effect=lambda k: {
                "site_dir": str(tmp_path),
                "extra_javascript": [],
            }[k]
        )

        plugin.on_post_build(config)

        config_content = (
            tmp_path / "assets" / "click-zoom" / "click-zoom-config.js"
        ).read_text()
        assert ".mermaid" in config_content
        assert ".custom-svg" in config_content
        assert "window.__clickZoomSelectors" in config_content

    def test_disabled_skips_copy(self, tmp_path: Path) -> None:
        plugin = ClickZoomPlugin()
        plugin.config = {"enabled": False, "selectors": []}
        config = MagicMock()
        config.__getitem__ = MagicMock(
            side_effect=lambda k: {"site_dir": str(tmp_path)}[k]
        )

        plugin.on_post_build(config)

        assert not (tmp_path / "assets" / "click-zoom").exists()


class TestAssets:
    """Verify that the bundled asset files exist."""

    def test_css_exists(self) -> None:
        assert (ASSETS_DIR / "click-zoom.css").is_file()

    def test_js_exists(self) -> None:
        assert (ASSETS_DIR / "click-zoom.js").is_file()


class TestIntegration:
    """Integration test: build a minimal MkDocs site with the plugin."""

    def test_build_minimal_site(self, minimal_site: Path, tmp_path: Path) -> None:
        """Build the minimal fixture site and verify assets are present."""
        from mkdocs.commands.build import build
        from mkdocs.config import load_config

        cfg = load_config(str(minimal_site / "mkdocs.yml"))
        cfg["site_dir"] = str(tmp_path / "site")
        build(cfg)

        site = tmp_path / "site"
        assert (site / "assets" / "click-zoom" / "click-zoom.js").exists()
        assert (site / "assets" / "click-zoom" / "click-zoom.css").exists()
        assert (site / "assets" / "click-zoom" / "click-zoom-config.js").exists()

        # Verify the index page was built
        index = site / "index.html"
        assert index.exists()
        html = index.read_text()
        assert "click-zoom" in html
