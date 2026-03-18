# mkdocs-click-zoom

Click-to-fullscreen zoom overlay for diagrams, SVGs, and images in MkDocs.

## Features

- **Click-to-zoom** — Click any diagram or image to open a fullscreen overlay
- **Multi-strategy zoom** — Automatically selects clone, fetch, or re-render based on content type
- **Mermaid Shadow DOM support** — Works with Zensical/Material's closed Shadow DOM by capturing source pre-render
- **SPA-aware** — Handles Zensical/Material `document$` navigation
- **Accessible** — `role="dialog"`, `aria-modal`, `aria-label`
- **Theme-agnostic** — Works with Zensical, Material, ReadTheDocs, and default MkDocs themes
- **Configurable selectors** — Choose which elements get zoom behavior
- **Zero dependencies** — Uses only native browser APIs

## Installation

```bash
pip install mkdocs-click-zoom
```

## Usage

Add the plugin to your `mkdocs.yml`:

```yaml
plugins:
  - click-zoom
```

For Zensical (`zensical.toml`):

```toml
[project.plugins.click-zoom]
```

## Configuration

```yaml
plugins:
  - click-zoom:
      enabled: true  # Enable/disable the plugin (default: true)
      selectors:     # CSS selectors for zoomable elements
        - ".mermaid"
        - "article svg"
        - 'article img[src$=".svg"]'
        - ".d2 svg"                  # D2 diagrams
        - 'img[src*="kroki"]'        # Kroki-generated images
```

### Default Selectors

If no `selectors` are specified, the plugin targets:

- `.mermaid` — Mermaid diagram containers
- `article svg` — Inline SVGs within article content
- `article img[src$=".svg"]` — SVG images within article content

## How It Works

The plugin uses three strategies depending on the content type:

| Strategy    | Used For                          | How                                    |
| ----------- | --------------------------------- | -------------------------------------- |
| **Clone**   | Inline SVGs (D2, Graphviz, etc.)  | `cloneNode(true)` into overlay         |
| **Fetch**   | `<img>` elements                  | Fetch SVG inline, or display as `<img>`|
| **Re-render** | Mermaid (Shadow DOM)            | Capture source, re-render via `mermaid.render()` |

Strategy is selected automatically based on the clicked element.

## Supported Content Types

- Mermaid (Zensical/Material Shadow DOM and standard themes)
- D2 (`mkdocs-d2`)
- PlantUML / Kroki
- Graphviz
- drawio exports
- Any `<img>` (raster or SVG)

## License

MIT
