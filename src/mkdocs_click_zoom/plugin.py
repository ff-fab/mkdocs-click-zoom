"""MkDocs plugin that adds click-to-fullscreen zoom for diagrams and SVGs."""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from typing import Any

from mkdocs.config import config_options
from mkdocs.config.defaults import MkDocsConfig
from mkdocs.plugins import BasePlugin

ASSETS_DIR = Path(__file__).parent / "assets"


class ClickZoomPlugin(BasePlugin):  # type: ignore[type-arg]
    """Click-to-fullscreen zoom overlay for diagrams, SVGs, and images."""

    config_scheme = (
        ("enabled", config_options.Type(bool, default=True)),
        ("selectors", config_options.Type(list, default=[
            ".mermaid",
            "article svg",
            'article img[src$=".svg"]',
        ])),
    )

    def on_config(self, config: MkDocsConfig, **kwargs: Any) -> MkDocsConfig:
        """Register CSS and JS assets and inject selector configuration."""
        if not self.config["enabled"]:
            return config

        css_path = "assets/click-zoom/click-zoom.css"
        js_path = "assets/click-zoom/click-zoom.js"

        if css_path not in config["extra_css"]:
            config["extra_css"].append(css_path)
        if js_path not in config["extra_javascript"]:
            # Insert at position 0 so the script runs before theme JS
            config["extra_javascript"].insert(0, js_path)

        return config

    def on_post_build(self, config: MkDocsConfig, **kwargs: Any) -> None:
        """Copy asset files into the built site directory."""
        if not self.config["enabled"]:
            return

        site_dir = config["site_dir"]
        output_dir = os.path.join(site_dir, "assets", "click-zoom")
        os.makedirs(output_dir, exist_ok=True)

        # Copy CSS and JS
        for filename in ("click-zoom.css", "click-zoom.js"):
            src = ASSETS_DIR / filename
            dst = os.path.join(output_dir, filename)
            shutil.copy2(str(src), dst)

        # Write selector config as a small JS file that sets a global
        selectors = self.config["selectors"]
        config_js = f"window.__clickZoomSelectors = {json.dumps(selectors)};\n"
        config_path = os.path.join(output_dir, "click-zoom-config.js")
        with open(config_path, "w") as f:
            f.write(config_js)

        # Ensure config script is in the output (injected before main JS)
        config_js_path = "assets/click-zoom/click-zoom-config.js"
        config_extra = config["extra_javascript"]
        if config_js_path not in config_extra:
            # Find where click-zoom.js is and insert config before it
            js_path = "assets/click-zoom/click-zoom.js"
            try:
                idx = config_extra.index(js_path)
                config_extra.insert(idx, config_js_path)
            except ValueError:
                config_extra.insert(0, config_js_path)
