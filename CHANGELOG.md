# Changelog

## [0.2.0](https://github.com/ff-fab/mkdocs-click-zoom/compare/v0.1.0...v0.2.0) (2026-03-28)


### Features

* :sparkles: initial commit ([ca31097](https://github.com/ff-fab/mkdocs-click-zoom/commit/ca31097a427381e21705e1e12e144c5800bc9cb9))
* conditional zoom (v0.2) — skip hint on content that won't enlarge ([#1](https://github.com/ff-fab/mkdocs-click-zoom/issues/1)) ([526bc91](https://github.com/ff-fab/mkdocs-click-zoom/commit/526bc9182dab830f3fbd878180c284ed2d19632e))


### Bug Fixes

* update installation instructions to use GitHub repository link ([507aead](https://github.com/ff-fab/mkdocs-click-zoom/commit/507aead52533990db81b1def3f3c9f49152e0915))

## 0.1.0

- Initial release
- Click-to-fullscreen zoom overlay for diagrams, SVGs, and images
- Three zoom strategies: clone, fetch, re-render (Mermaid Shadow DOM)
- SPA-aware navigation handling (Zensical/Material `document$`)
- Configurable CSS selectors
- Accessible overlay with `role="dialog"`, `aria-modal`, keyboard dismiss
