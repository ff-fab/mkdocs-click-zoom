# mkdocs-click-zoom — Design Specification

> **Purpose:** Bootstrap document for creating `mkdocs-click-zoom` — a standalone
> MkDocs plugin that adds click-to-fullscreen zoom for diagrams, SVGs, and images.
> Works with any content type; includes a specialized strategy for Mermaid diagrams
> behind Zensical/Material's closed Shadow DOM.

**Repository:** https://github.com/ff-fab/mkdocs-click-zoom

## Origin

This plugin generalizes the mermaid-zoom feature from [cosalette][]. The original
implementation lives in:

- `docs/javascripts/mermaid-zoom.js` — event delegation, source capture,
  re-rendering, overlay
- `docs/stylesheets/mermaid-zoom.css` — cursor hints, overlay styles, close hint

The original was Mermaid-only because of a specific technical constraint: Zensical
and Material for MkDocs render Mermaid SVGs inside a **closed Shadow DOM**, making
the rendered SVG inaccessible. But the fullscreen overlay UX is valuable for _all_
visual content — so the plugin generalizes with multiple zoom strategies.

[cosalette]: https://github.com/ff-fab/cosalette

---

## Feature Summary

| Feature                   | Description                                             |
| ------------------------- | ------------------------------------------------------- |
| Click-to-zoom             | Click any matching element → fullscreen overlay         |
| Multi-strategy zoom       | Clone, fetch, or re-render — chosen per content type    |
| Mermaid Shadow DOM support| Captures source pre-Shadow DOM, re-renders via mermaid API |
| Escape / click to close   | Keyboard and mouse dismiss                              |
| SPA-aware                 | Handles Zensical/Material `document$` navigation        |
| Accessible                | `role="dialog"`, `aria-modal`, `aria-label`             |
| Theme-agnostic            | Works with Zensical, Material, ReadTheDocs, default     |
| Configurable selectors    | Choose which elements get zoom behavior                 |
| Conditional zoom (v0.2)   | Only offer zoom on content that benefits from enlargement |

---

## Zoom Strategies

The plugin uses three strategies depending on the content type. The strategy is
selected automatically based on what's found in the DOM.

### 1. Clone Strategy (default)

For inline `<svg>` elements and any DOM node that can be `cloneNode(true)`'d.

- **Used for:** D2, Graphviz, PlantUML (inline), any inline SVG
- **How:** `element.cloneNode(true)` → inject into overlay
- **Dependencies:** None
- **Limitation:** Cannot reach into closed Shadow DOM

### 2. Fetch Strategy

For `<img>` elements with SVG or image sources.

- **Used for:** Kroki output, PlantUML (as `<img>`), drawio exports, any `<img>`
- **How:** Read `img.src`, fetch if SVG (display inline), or create new `<img>` for
  raster formats
- **Dependencies:** None
- **Limitation:** Cross-origin SVGs may be blocked by CORS (falls back to `<img>`
  display)

### 3. Re-render Strategy (Mermaid-specific)

For Mermaid diagrams behind closed Shadow DOM.

- **Used for:** Mermaid in Zensical / Material for MkDocs
- **How:** Capture raw source from `<pre class="mermaid"><code>` before theme
  processing, re-render via `mermaid.render()` on click
- **Dependencies:** Mermaid API (loaded by theme, not bundled)
- **Limitation:** Must run before the theme's JS processes Mermaid fences

### Strategy Selection Logic

```
for each clicked element matching a configured selector:
  1. Is it a .mermaid container with captured sources? → RE-RENDER
  2. Is it an <img>?                                  → FETCH
  3. Does it contain an <svg> or is it an <svg>?      → CLONE
  4. Otherwise                                        → skip (no zoom)
```

---

## Content Type Support

| Content Type                   | DOM Representation          | Strategy   |
| ------------------------------ | --------------------------- | ---------- |
| Mermaid (Zensical/Material)    | Closed Shadow DOM container | Re-render  |
| Mermaid (other themes)         | Inline `<svg>`              | Clone      |
| D2 (`mkdocs-d2`)              | Inline `<svg>` or `<img>`   | Clone/Fetch|
| PlantUML (kroki/plantuml)      | `<img src="*.svg">` or inline | Fetch/Clone |
| Kroki (multi-format)           | `<img>` or inline `<svg>`   | Fetch/Clone|
| Graphviz                       | Inline `<svg>`              | Clone      |
| drawio                         | `<img>` or `<object>`       | Fetch      |
| Any `<img>` (raster or SVG)    | `<img>`                     | Fetch      |

---

## Architecture

### Plugin Type: MkDocs `BasePlugin`

```text
mkdocs-click-zoom/
├── pyproject.toml                  # PEP 621 metadata, hatch build
├── README.md
├── LICENSE                         # MIT
├── CHANGELOG.md
├── src/
│   └── mkdocs_click_zoom/
│       ├── __init__.py
│       ├── plugin.py               # MkDocs BasePlugin subclass
│       └── assets/
│           ├── click-zoom.js       # Client-side zoom logic (all strategies)
│           └── click-zoom.css      # Overlay and cursor styles
└── tests/
    ├── conftest.py
    ├── test_plugin.py              # Plugin hook tests
    └── fixtures/
        └── minimal-site/           # Minimal MkDocs project for integration tests
            ├── mkdocs.yml
            └── docs/
                └── index.md        # Contains mermaid + SVG content
```

### Plugin Hooks

| Hook            | Purpose                                                      |
| --------------- | ------------------------------------------------------------ |
| `on_config`     | Register CSS + JS as `extra_css` / `extra_javascript`        |
| `on_post_build` | Copy asset files from package into `site/` output directory  |

No HTML post-processing needed. The JS handles everything client-side.

### Configuration Options (plugin.py)

```python
from mkdocs.config import config_options
from mkdocs.plugins import BasePlugin

class ClickZoomPlugin(BasePlugin):
    config_scheme = (
        ("enabled", config_options.Type(bool, default=True)),
        # CSS selectors for zoomable elements.
        # Default covers Mermaid containers, inline SVGs in article content,
        # and SVG images.
        ("selectors", config_options.Type(list, default=[
            ".mermaid",
            "article svg",
            'article img[src$=".svg"]',
        ])),
    )
```

The `selectors` option lets users add zoom to any content:

```yaml
plugins:
  - click-zoom:
      selectors:
        - ".mermaid"
        - "article svg"
        - 'article img[src$=".svg"]'
        - ".d2 svg"                    # D2 diagrams
        - 'img[src*="kroki"]'          # Kroki-generated images
```

### Entry Point

```toml
[project.entry-points."mkdocs.plugins"]
click-zoom = "mkdocs_click_zoom.plugin:ClickZoomPlugin"
```

### User Configuration

```yaml
# mkdocs.yml
plugins:
  - click-zoom
```

For Zensical (`zensical.toml`):

```toml
[project.plugins.click-zoom]
```

---

## Client-Side Logic (click-zoom.js)

### Initialization

The JS receives the configured selectors from the plugin. The plugin injects them
as a `<script>` data attribute or inline JSON that the JS reads on load.

```javascript
// Read selectors from plugin-injected config
var config = JSON.parse(
  document.querySelector("[data-click-zoom-config]")
    ?.getAttribute("data-click-zoom-config") || "{}"
);
var selectors = config.selectors || [".mermaid", "article svg"];
```

**Alternative (simpler for v1):** Hardcode the default selectors and let users who
need customization override via the plugin config. The plugin can inject a small
inline `<script>` setting `window.__clickZoomSelectors = [...]` before the main JS.

### Mermaid Source Capture

Only runs if `.mermaid` is among the selectors.

```javascript
// Captures raw Mermaid source from <pre class="mermaid"><code>…</code></pre>
// BEFORE the theme's JS replaces them with Shadow DOM containers.
//
// Two strategies:
// 1. Elements still have .mermaid class
// 2. Class already removed — scan <pre><code> for Mermaid keywords
```

**Key detail:** The script must run early enough to capture sources before the
theme processes them. MkDocs loads `extra_javascript` files in document order,
and the mermaid CDN script is loaded asynchronously by the theme — so our script
wins the race naturally.

### SPA Navigation

```javascript
// Zensical/Material for MkDocs expose a document$ RxJS observable
if (typeof document$ !== "undefined") {
  document$.subscribe(function () {
    captureSources();     // Re-capture Mermaid sources on page change
    applyZoomHints();     // Re-apply cursor hints to new content
  });
} else {
  // Fallback: MutationObserver watching for URL changes
}
```

### Click Handler (Event Delegation)

Single click handler on `document` (capture phase):

```javascript
document.addEventListener("click", function (e) {
  // 1. Walk up from target to find an element matching any selector
  var matched = findMatchingAncestor(e.target, selectors);
  if (!matched) return;

  // 2. Determine strategy
  if (matched.classList.contains("mermaid") && hasCapturedSource(matched)) {
    // RE-RENDER strategy
    reRenderMermaid(matched);
  } else if (matched.tagName === "IMG") {
    // FETCH strategy
    fetchAndDisplay(matched.src);
  } else {
    // CLONE strategy — find SVG within or use element itself
    var svg = matched.tagName === "svg" ? matched : matched.querySelector("svg");
    if (svg) cloneAndDisplay(svg);
  }
}, true);
```

### SVG Width Fix

Mermaid 11+ produces SVGs with `width="100%"` and `style="max-width: Xpx"`.
Inside a flex container, `100%` has no intrinsic size, so the SVG collapses.
The JS promotes the `max-width` pixel value to `width` and sets
`max-width: 100%` to let the container constrain it.

This fix applies to all strategies that display SVGs in the overlay, not just
Mermaid re-renders.

---

## Styles (click-zoom.css)

```css
/* Cursor hint — signal clickability on all zoomable elements */
[data-click-zoom] {
  cursor: zoom-in;
  transition: opacity 0.15s ease;
}
[data-click-zoom]:hover {
  opacity: 0.85;
}

/* Fullscreen overlay */
.click-zoom-overlay {
  position: fixed; inset: 0; z-index: 9999;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.82); cursor: zoom-out;
  opacity: 0; transition: opacity 0.2s ease;
}
.click-zoom-overlay.active { opacity: 1; }

/* Content container inside overlay */
.click-zoom-content {
  max-width: 92vw; max-height: 92vh; overflow: auto;
  filter: drop-shadow(0 4px 24px rgba(0, 0, 0, 0.4));
  background: var(--md-default-bg-color, #fff);
  border-radius: 8px; padding: 1.5rem; cursor: default;
}
.click-zoom-content svg {
  display: block;
  max-width: 88vw !important; max-height: 85vh !important;
  height: auto !important;
}
.click-zoom-content img {
  display: block;
  max-width: 88vw; max-height: 85vh;
  height: auto;
}

/* Close hint */
.click-zoom-close {
  position: absolute; top: 1rem; right: 1.5rem;
  color: rgba(255, 255, 255, 0.7);
  font: 500 0.9rem/1 var(--md-text-font-family, system-ui, sans-serif);
  pointer-events: none; user-select: none;
}
```

**Key change from the original:** Instead of targeting `.mermaid` directly, the JS
applies a `data-click-zoom` attribute to matched elements. This keeps CSS decoupled
from content type — any zoomable element gets the cursor hint.

Uses CSS custom property `--md-default-bg-color` which both Material and Zensical
define. Falls back to `#fff` for other themes.

---

## Compatibility Matrix

| Theme / Framework        | Shadow DOM? | `document$`? | Status     |
| ------------------------ | ----------- | ------------ | ---------- |
| Zensical                 | Yes (closed)| Yes          | Primary    |
| Material for MkDocs      | Yes (closed)| Yes          | Primary    |
| MkDocs default           | No          | No           | Supported  |
| ReadTheDocs theme        | No          | No           | Supported  |

The clone/fetch strategies work universally. The re-render strategy is the
fallback for Mermaid in Shadow DOM environments.

---

## Differences from mkdocs-panzoom

| Aspect                | mkdocs-click-zoom (ours)          | mkdocs-panzoom              |
| --------------------- | --------------------------------- | --------------------------- |
| Interaction           | Click → fullscreen overlay        | Alt+scroll in-place         |
| Shadow DOM            | Full support (re-render)          | Breaks                      |
| Dependencies          | Zero JS deps (uses native APIs)   | panzoom.js (~14 KB)         |
| Scope                 | Any SVG, image, or diagram        | Mermaid + images + d2       |
| HTML modification     | None (pure client-side)           | Regex wrapping in post_page |
| Strategy selection    | Automatic per content type        | One-size-fits-all wrapping  |
| Conditional zoom      | Planned (v0.2)                    | No                          |

---

## Project Setup

### Python Environment

- **Minimum Python:** 3.10 (matches MkDocs 1.6+ requirement)
- **Build system:** Hatch (modern, PEP 621 compliant)
- **Linting:** ruff
- **Type checking:** mypy
- **Testing:** pytest

### pyproject.toml Skeleton

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "mkdocs-click-zoom"
version = "0.1.0"
description = "Click-to-fullscreen zoom overlay for diagrams and SVGs in MkDocs"
readme = "README.md"
license = "MIT"
requires-python = ">=3.10"
authors = [{ name = "ff-fab" }]
keywords = ["mkdocs", "mermaid", "zoom", "plugin", "diagrams", "svg"]
classifiers = [
    "Development Status :: 3 - Alpha",
    "Intended Audience :: Developers",
    "License :: OSI Approved :: MIT License",
    "Programming Language :: Python :: 3",
    "Programming Language :: Python :: 3.10",
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
    "Programming Language :: Python :: 3.13",
    "Topic :: Documentation",
    "Topic :: Software Development :: Documentation",
]
dependencies = ["mkdocs>=1.6"]

[project.entry-points."mkdocs.plugins"]
click-zoom = "mkdocs_click_zoom.plugin:ClickZoomPlugin"

[project.urls]
Homepage = "https://github.com/ff-fab/mkdocs-click-zoom"
Repository = "https://github.com/ff-fab/mkdocs-click-zoom"
Issues = "https://github.com/ff-fab/mkdocs-click-zoom/issues"

[tool.hatch.build.targets.sdist]
include = ["src/mkdocs_click_zoom/"]

[tool.hatch.build.targets.wheel]
packages = ["src/mkdocs_click_zoom"]

[tool.ruff]
target-version = "py310"
line-length = 88

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "SIM"]

[tool.mypy]
python_version = "3.10"
strict = true

[tool.pytest.ini_options]
testpaths = ["tests"]
```

### Package Data

The plugin must include `assets/click-zoom.js` and `assets/click-zoom.css`
in the wheel. Hatch handles this automatically when files are under the package
directory.

---

## Implementation Roadmap

### v0.1.0 — MVP

1. [ ] Scaffold project structure (pyproject.toml, src layout, tests)
2. [ ] Implement `plugin.py` with `on_config` and `on_post_build` hooks
3. [ ] Implement `click-zoom.js` with all three strategies (clone, fetch, re-render)
4. [ ] Implement `click-zoom.css` using `data-click-zoom` attribute
5. [ ] Write unit tests for plugin hooks
6. [ ] Write integration test with minimal MkDocs site (mermaid + inline SVG + img)
7. [ ] Add CI (GitHub Actions: lint, type-check, test on Python 3.10–3.13)
8. [ ] Write README with installation, usage, and configuration docs
9. [ ] Test with Zensical (cosalette docs) by installing from local path
10. [ ] Publish to PyPI

### v0.2.0 — Conditional Zoom

11. [ ] Add conditional zoom: probe-render / size comparison to skip small content
12. [ ] Port logic from cosalette PR #120

### v0.3.0 — Polish

13. [ ] Configuration for overlay background color
14. [ ] Configuration for max dimensions
15. [ ] Keyboard navigation (arrow keys for next/prev diagram?)

### Migration

16. [ ] Update cosalette to use `mkdocs-click-zoom` plugin instead of inline files
17. [ ] Remove `docs/javascripts/mermaid-zoom.js` and `docs/stylesheets/mermaid-zoom.css`

---

## Key Technical Notes for Implementation

### Closed Shadow DOM Workaround (Mermaid Only)

This is the plugin's key differentiator for Mermaid support:

```
Zensical/Material renders Mermaid like this:
  1. <pre class="mermaid"><code>graph LR; A-->B</code></pre>  ← initial DOM
  2. Theme JS reads the source, removes .mermaid class
  3. Creates a <div> with attachShadow({mode:"closed"})
  4. Renders SVG inside the shadow root
  5. The SVG is now completely inaccessible from outside

Our workaround:
  1. Script runs before theme JS (extra_javascript loads first)
  2. Captures all raw Mermaid source text into a map
  3. On click, re-renders from captured source via mermaid.render()
  4. Displays the fresh SVG in a fullscreen overlay
```

For all other content types (inline SVG, images), the clone/fetch strategies
work without any workaround.

### Mermaid API Availability

The plugin does NOT bundle or load Mermaid. It assumes the theme or user has
already loaded it (Material/Zensical do this automatically for mermaid fences).
The click handler simply checks `typeof mermaid !== "undefined"` before attempting
to render.

### Race Condition Safety

The script captures Mermaid sources synchronously on load. Mermaid is loaded
asynchronously from CDN by the theme. Since `extra_javascript` is a regular
`<script>` tag (synchronous, blocking), it executes before the async CDN fetch
completes — so sources are always captured in time.

### Security Considerations

- **Clone strategy:** Safe — `cloneNode(true)` preserves the existing DOM structure
  without executing scripts.
- **Fetch strategy:** Uses the `img.src` that's already in the DOM — no user-provided
  URLs. SVG content fetched via `fetch()` is injected via `innerHTML` into an isolated
  overlay container. The source URL is same-origin (built site assets).
- **Re-render strategy:** Uses the Mermaid API which has its own sanitization.
  Source text was captured from the page's own `<pre>` elements — not user input.

---

## Appendix: Reference Implementation (cosalette)

The complete working source from the cosalette project. This is the Mermaid-only
version — the plugin should generalize it with the clone/fetch strategies described
above, rename classes from `mermaid-zoom-*` to `click-zoom-*`, and use the
`data-click-zoom` attribute for cursor hints.

### mermaid-zoom.js

```javascript
/* Mermaid diagram zoom — click to fullscreen overlay ---------------------- */
/*                                                                             */
/* Why re-render instead of cloning the SVG?                                   */
/* Zensical (Material for MkDocs) renders Mermaid SVGs inside a *closed*       */
/* Shadow DOM:  r.attachShadow({mode:"closed"}).  This makes the SVG           */
/* completely inaccessible via querySelector or any DOM API.                    */
/* So we capture the Mermaid source text before it's processed, and            */
/* re-render it on demand via mermaid.render() when the user clicks.           */

;(function () {
  "use strict";

  var overlay = null;
  var prevOverflow = "";    // saved body overflow before opening
  var sourcesByPath = {};   // pathname → [source, source, …]
  var MERMAID_KW = /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|gitgraph|mindmap|timeline|quadrantChart|sankey|xychart)\b/i;

  /* ── Source capture ────────────────────────────────────────────────── */

  /**
   * Grab the raw Mermaid code from <pre class="mermaid"><code>…</code></pre>
   * elements that exist in the DOM right now — before the theme's JS replaces
   * them with shadow-DOM containers.
   *
   * The Zensical bundle removes the "mermaid" class synchronously when it
   * starts processing, so we also fall back to sniffing <pre><code> text for
   * Mermaid keywords (graph, flowchart, sequenceDiagram, etc.).
   */
  function captureSources() {
    var key = window.location.pathname;
    if (sourcesByPath[key]) return;          // already captured this page

    var sources = [];

    // Strategy 1: elements still have the class
    var preElems = document.querySelectorAll("pre.mermaid");

    // Strategy 2: class already removed — scan all <pre><code> for keywords
    if (preElems.length === 0) {
      var candidates = [];
      document.querySelectorAll("pre > code").forEach(function (code) {
        if (MERMAID_KW.test(code.textContent.trim())) {
          candidates.push(code.parentElement);
        }
      });
      preElems = candidates;
    }

    Array.prototype.forEach.call(preElems, function (pre) {
      var code = pre.querySelector("code");
      sources.push(code ? code.textContent.trim() : pre.textContent.trim());
    });

    if (sources.length > 0) {
      sourcesByPath[key] = sources;
    }
  }

  // Capture immediately — our script runs before the async CDN mermaid load
  captureSources();

  // Re-capture after SPA navigations (Zensical instant loading)
  if (typeof document$ !== "undefined") {
    // Zensical/Material exposes a document$ observable on content swap
    document$.subscribe(function () { captureSources(); });
  } else {
    // Fallback: watch for URL changes
    var lastPath = window.location.pathname;
    var navObserver = new MutationObserver(function () {
      if (window.location.pathname !== lastPath) {
        lastPath = window.location.pathname;
        captureSources();
      }
    });
    navObserver.observe(document.body, { childList: true, subtree: true });
  }

  /* ── Overlay ───────────────────────────────────────────────────────── */

  function getOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "mermaid-zoom-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label",
      "Zoomed diagram — click or press Escape to close");

    var hint = document.createElement("span");
    hint.className = "mermaid-zoom-close";
    hint.textContent = "Click or press Esc to close";
    overlay.appendChild(hint);

    overlay.addEventListener("click", function (e) {
      // Only close when clicking the backdrop, not the diagram content
      if (e.target === overlay || e.target === hint) { closeOverlay(); }
    });
    return overlay;
  }

  function openOverlayWithSvg(svgMarkup) {
    var el = getOverlay();
    // Remove any previous content
    var prev = el.querySelector(".mermaid-zoom-content");
    if (prev) prev.remove();

    var container = document.createElement("div");
    container.className = "mermaid-zoom-content";
    container.innerHTML = svgMarkup;

    // Mermaid 11 produces SVGs with width="100%" and an inline
    // style="max-width: 3248px".  Inside a flex container "100%" has
    // no intrinsic size, so the SVG collapses.  Fix: promote the
    // max-width pixel value to the actual width so the SVG has a
    // concrete intrinsic size; CSS on the container then caps it.
    var svg = container.querySelector("svg");
    if (svg) {
      var mw = svg.style.maxWidth;          // e.g. "3248.91px"
      if (mw && mw.endsWith("px")) {
        svg.style.width = mw;              // give it a real pixel width
        svg.style.maxWidth = "100%";       // let container constrain it
      }
    }

    el.appendChild(container);
    document.body.appendChild(el);
    void el.offsetWidth;                    // force reflow for transition
    el.classList.add("active");
    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }

  function closeOverlay() {
    if (!overlay) return;
    overlay.classList.remove("active");
    document.body.style.overflow = prevOverflow;

    function removeOverlay() {
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    // Timeout fallback: if transitionend never fires (reduced-motion,
    // CSS not loaded, etc.), remove the overlay anyway after 300ms.
    var fallback = setTimeout(removeOverlay, 300);
    overlay.addEventListener("transitionend", function handler() {
      overlay.removeEventListener("transitionend", handler);
      clearTimeout(fallback);
      removeOverlay();
    }, { once: true });
  }

  /* ── Click handling (event delegation) ─────────────────────────────── */

  /**
   * Walk up from the click target to find the .mermaid container,
   * then determine its index among all .mermaid containers on the page.
   */
  function findMermaidIndex(target) {
    var el = target;
    for (var i = 0; i < 10 && el && el !== document.body; i++) {
      if (el.classList && el.classList.contains("mermaid")) {
        var all = document.querySelectorAll(".mermaid");
        return Array.prototype.indexOf.call(all, el);
      }
      el = el.parentElement;
    }
    return -1;
  }

  var renderCounter = 0;

  document.addEventListener("click", function (e) {
    if (overlay && overlay.classList.contains("active")) return;

    var index = findMermaidIndex(e.target);
    if (index < 0) return;

    var sources = sourcesByPath[window.location.pathname];
    if (!sources || index >= sources.length) return;

    // mermaid is loaded by the theme from CDN — it must be available by
    // the time the user can see (and click) a rendered diagram.
    if (typeof mermaid === "undefined") return;

    e.preventDefault();
    e.stopPropagation();

    var id = "__mermaid_zoom_" + (renderCounter++);
    var source = sources[index];

    mermaid.render(id, source).then(function (result) {
      openOverlayWithSvg(result.svg);
    }).catch(function (err) {
      console.error("[mermaid-zoom] render failed:", err);
    });
  }, true);     // capture phase to beat any stopPropagation in the theme

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && overlay && overlay.classList.contains("active")) {
      closeOverlay();
    }
  });
})();
```

### mermaid-zoom.css

```css
/* Mermaid diagram zoom overlay ------------------------------------------- */

/* Hint: show pointer cursor on diagrams to signal clickability */
.mermaid,
.mermaid svg {
  cursor: zoom-in;
  transition: opacity 0.15s ease;
}
.mermaid:hover {
  opacity: 0.85;
}

/* Fullscreen overlay */
.mermaid-zoom-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.82);
  cursor: zoom-out;
  opacity: 0;
  transition: opacity 0.2s ease;
}
.mermaid-zoom-overlay.active {
  opacity: 1;
}

/* The re-rendered SVG container inside the overlay */
.mermaid-zoom-content {
  max-width: 92vw;
  max-height: 92vh;
  overflow: auto;
  filter: drop-shadow(0 4px 24px rgba(0, 0, 0, 0.4));
  background: var(--md-default-bg-color, #fff);
  border-radius: 8px;
  padding: 1.5rem;
  /* Prevent click-through to the overlay dismiss handler */
  cursor: default;
}
/* Let the SVG render at its natural size, capped by the container */
.mermaid-zoom-content svg {
  display: block;
  max-width: 88vw !important;
  max-height: 85vh !important;
  height: auto !important;
}

/* Close hint in top-right corner */
.mermaid-zoom-close {
  position: absolute;
  top: 1rem;
  right: 1.5rem;
  color: rgba(255, 255, 255, 0.7);
  font: 500 0.9rem/1 var(--md-text-font-family, system-ui, sans-serif);
  pointer-events: none;
  user-select: none;
}
```
