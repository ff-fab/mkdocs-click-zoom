/* click-zoom — Click-to-fullscreen zoom for diagrams, SVGs, and images ---- */
/*                                                                             */
/* Strategies:                                                                 */
/*   1. RE-RENDER — Mermaid diagrams behind closed Shadow DOM                  */
/*   2. FETCH     — <img> elements (SVG fetched inline, raster as <img>)       */
/*   3. CLONE     — Inline <svg> elements via cloneNode(true)                  */

;(function () {
  "use strict";

  var overlay = null;
  var prevOverflow = "";
  var sourcesByPath = {};
  var probeGeneration = 0;
  var selectors = window.__clickZoomSelectors || [
    ".mermaid",
    "article svg",
    'article img[src$=".svg"]',
  ];
  var MERMAID_KW =
    /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|gitgraph|mindmap|timeline|quadrantChart|sankey|xychart)\b/i;

  /* ── Mermaid source capture ──────────────────────────────────────────── */

  var hasMermaidSelector = selectors.some(function (s) {
    return s.indexOf(".mermaid") !== -1;
  });

  function captureSources() {
    if (!hasMermaidSelector) return;

    var key = window.location.pathname;
    if (sourcesByPath[key]) return;

    var sources = [];

    // Strategy 1: elements still have the .mermaid class
    var preElems = document.querySelectorAll("pre.mermaid");

    // Strategy 2: class already removed — scan <pre><code> for keywords
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

  // Capture immediately — runs before async CDN mermaid load
  captureSources();

  /* ── SPA navigation handling ─────────────────────────────────────────── */

  function onPageChange() {
    captureSources();
    probeGeneration++;
    applyZoomHints();
  }

  if (typeof document$ !== "undefined") {
    document$.subscribe(function () {
      onPageChange();
    });
  } else {
    var lastPath = window.location.pathname;
    var navObserver = new MutationObserver(function () {
      if (window.location.pathname !== lastPath) {
        lastPath = window.location.pathname;
        onPageChange();
      }
    });
    navObserver.observe(document.body, { childList: true, subtree: true });
  }

  /* ── Zoom hints ──────────────────────────────────────────────────────── */

  var ZOOM_THRESHOLD = 8; // px — minimum gain needed to offer zoom

  /* Returns true if showing `el` in the overlay would make it appear larger.
   * Conservative: returns true when natural size cannot be determined.      */
  function wouldBenefitFromZoom(el) {
    var renderedWidth = el.getBoundingClientRect().width;

    if (el.tagName === "IMG") {
      // naturalWidth is 0 for SVG images before the load event fires.
      // Treat 0 as unknown → allow zoom.
      if (el.naturalWidth === 0) return true;
      return el.naturalWidth > renderedWidth + ZOOM_THRESHOLD;
    }

    if (el.tagName === "svg" || el.tagName === "SVG") {
      // Mermaid 11+: style="max-width: Npx" carries the true intrinsic width
      var mw = el.style.maxWidth;
      if (mw && mw.endsWith("px")) {
        return parseFloat(mw) > renderedWidth + ZOOM_THRESHOLD;
      }
      // Non-percent numeric width attribute on hand-authored SVGs
      var wAttr = el.getAttribute("width");
      if (wAttr && !wAttr.endsWith("%")) {
        var w = parseFloat(wAttr);
        if (!isNaN(w)) return w > renderedWidth + ZOOM_THRESHOLD;
      }
      // width="100%" or no usable size info — intrinsic width unknown, allow zoom
      return true;
    }

    return true; // any other element type — caller should use probe instead
  }

  /* Probe-renders each captured Mermaid source to measure its natural width,
   * then applies data-click-zoom only if the overlay would show it larger.  */
  function applyMermaidZoomHints(generation) {
    if (typeof mermaid === "undefined") return;

    var sources = sourcesByPath[window.location.pathname];
    if (!sources || sources.length === 0) return;

    var mermaidEls = document.querySelectorAll(".mermaid");

    Array.prototype.forEach.call(mermaidEls, function (el, index) {
      if (generation !== probeGeneration) return;

      var source = sources[index];
      if (!source) {
        el.setAttribute("data-click-zoom", "");
        return;
      }

      var probeId = "__click_zoom_probe_" + generation + "_" + index;

      mermaid
        .render(probeId, source)
        .then(function (result) {
          if (generation !== probeGeneration) return;

          // Clean up any stray element Mermaid inserted during render
          var stray = document.getElementById(probeId);
          if (stray && stray.parentNode) stray.parentNode.removeChild(stray);

          var naturalWidth = 0;
          // Primary: max-width:Npx in SVG style attribute (Mermaid 11+)
          var mwMatch = result.svg.match(/max-width:\s*([\d.]+)px/);
          if (mwMatch) naturalWidth = parseFloat(mwMatch[1]);
          // Fallback: viewBox="x y w h" — third token is width
          if (naturalWidth === 0) {
            var vbMatch = result.svg.match(
              /viewBox="[\d.\-]+\s+[\d.\-]+\s+([\d.]+)/
            );
            if (vbMatch) naturalWidth = parseFloat(vbMatch[1]);
          }

          var renderedWidth = el.getBoundingClientRect().width;
          if (naturalWidth === 0 || naturalWidth > renderedWidth + ZOOM_THRESHOLD) {
            el.setAttribute("data-click-zoom", "");
          }
        })
        .catch(function () {
          if (generation !== probeGeneration) return;
          var stray = document.getElementById(probeId);
          if (stray && stray.parentNode) stray.parentNode.removeChild(stray);
          el.setAttribute("data-click-zoom", ""); // render failed — allow zoom
        });
    });
  }

  /* Polls until Mermaid has finished rendering all diagrams, then probes.
   * The .mermaid code selector goes to zero when processing completes.     */
  function waitForMermaidThenProbe(generation) {
    var attempts = 0;

    function poll() {
      if (generation !== probeGeneration) return;

      var ready =
        typeof mermaid !== "undefined" &&
        document.querySelectorAll(".mermaid code").length === 0;

      if (ready) {
        applyMermaidZoomHints(generation);
        return;
      }

      if (++attempts >= 60) {
        // Timed out — fall back to unconditional hints
        if (generation !== probeGeneration) return;
        document.querySelectorAll(".mermaid").forEach(function (el) {
          el.setAttribute("data-click-zoom", "");
        });
        return;
      }

      setTimeout(poll, 100);
    }

    poll();
  }

  function applyZoomHints() {
    var combined = selectors.join(", ");
    try {
      document.querySelectorAll(combined).forEach(function (el) {
        // .mermaid elements need a probe-render to measure natural size — deferred
        if (el.classList && el.classList.contains("mermaid")) return;
        if (wouldBenefitFromZoom(el)) {
          el.setAttribute("data-click-zoom", "");
        }
      });
    } catch (_) {
      // Invalid selector — silently skip
    }

    if (hasMermaidSelector) {
      waitForMermaidThenProbe(probeGeneration);
    }
  }

  // Apply hints once DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyZoomHints);
  } else {
    applyZoomHints();
  }

  /* ── Overlay ─────────────────────────────────────────────────────────── */

  function getOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "click-zoom-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute(
      "aria-label",
      "Zoomed content — click or press Escape to close"
    );

    var hint = document.createElement("span");
    hint.className = "click-zoom-close";
    hint.textContent = "Click or press Esc to close";
    overlay.appendChild(hint);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay || e.target === hint) {
        closeOverlay();
      }
    });
    return overlay;
  }

  function fixSvgWidth(container) {
    var svg = container.querySelector("svg");
    if (svg) {
      var mw = svg.style.maxWidth;
      if (mw && mw.endsWith("px")) {
        svg.style.width = mw;
        svg.style.maxWidth = "100%";
      }
    }
  }

  function openOverlayWithContent(contentEl) {
    var el = getOverlay();
    var prev = el.querySelector(".click-zoom-content");
    if (prev) prev.remove();

    var container = document.createElement("div");
    container.className = "click-zoom-content";

    if (typeof contentEl === "string") {
      container.innerHTML = contentEl;
    } else {
      container.appendChild(contentEl);
    }

    fixSvgWidth(container);

    el.appendChild(container);
    document.body.appendChild(el);
    void el.offsetWidth; // force reflow for transition
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
    var fallback = setTimeout(removeOverlay, 300);
    overlay.addEventListener(
      "transitionend",
      function handler() {
        overlay.removeEventListener("transitionend", handler);
        clearTimeout(fallback);
        removeOverlay();
      },
      { once: true }
    );
  }

  /* ── Strategy: Clone ─────────────────────────────────────────────────── */

  function cloneAndDisplay(svgEl) {
    var clone = svgEl.cloneNode(true);
    openOverlayWithContent(clone);
  }

  /* ── Strategy: Fetch ─────────────────────────────────────────────────── */

  function fetchAndDisplay(src) {
    if (src.toLowerCase().endsWith(".svg") || src.indexOf(".svg") !== -1) {
      fetch(src)
        .then(function (r) {
          if (!r.ok) throw new Error("Fetch failed: " + r.status);
          return r.text();
        })
        .then(function (svgText) {
          openOverlayWithContent(svgText);
        })
        .catch(function () {
          // CORS or network error — fall back to <img> display
          displayAsImg(src);
        });
    } else {
      displayAsImg(src);
    }
  }

  function displayAsImg(src) {
    var img = document.createElement("img");
    img.src = src;
    img.alt = "Zoomed image";
    openOverlayWithContent(img);
  }

  /* ── Strategy: Re-render (Mermaid) ───────────────────────────────────── */

  var renderCounter = 0;

  function reRenderMermaid(el) {
    var sources = sourcesByPath[window.location.pathname];
    if (!sources) return;

    var all = document.querySelectorAll(".mermaid");
    var index = Array.prototype.indexOf.call(all, el);
    if (index < 0 || index >= sources.length) return;

    if (typeof mermaid === "undefined") return;

    var id = "__click_zoom_mermaid_" + renderCounter++;
    var source = sources[index];

    mermaid
      .render(id, source)
      .then(function (result) {
        openOverlayWithContent(result.svg);
      })
      .catch(function (err) {
        console.error("[click-zoom] Mermaid render failed:", err);
      });
  }

  /* ── Matching helper ─────────────────────────────────────────────────── */

  function findMatchingAncestor(target, sels) {
    var combined = sels.join(", ");
    var el = target;
    for (var i = 0; i < 15 && el && el !== document.body; i++) {
      try {
        if (el.matches && el.matches(combined)) return el;
      } catch (_) {
        break;
      }
      el = el.parentElement;
    }
    return null;
  }

  /* ── Click handler (event delegation) ────────────────────────────────── */

  document.addEventListener(
    "click",
    function (e) {
      if (overlay && overlay.classList.contains("active")) return;

      var matched = findMatchingAncestor(e.target, selectors);
      if (!matched) return;

      e.preventDefault();
      e.stopPropagation();

      // Strategy selection
      if (
        matched.classList.contains("mermaid") &&
        sourcesByPath[window.location.pathname]
      ) {
        reRenderMermaid(matched);
      } else if (matched.tagName === "IMG") {
        fetchAndDisplay(matched.src);
      } else {
        var svg =
          matched.tagName === "svg" ? matched : matched.querySelector("svg");
        if (svg) {
          cloneAndDisplay(svg);
        }
      }
    },
    true
  ); // capture phase

  /* ── Keyboard handler ────────────────────────────────────────────────── */

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && overlay && overlay.classList.contains("active")) {
      closeOverlay();
    }
  });
})();
