import { loadData } from "./data.js";
import { createStore } from "./store.js";
import { createTiles } from "./tiles.js";
import { createTimeline } from "./timeline.js";
import { createReadout, createFacetToggle, createControls, createLegend, createTooltip, createSources } from "./ui.js";

function showError(message) {
  const wrap = document.getElementById("tiles-wrap");
  wrap.replaceChildren();
  const p = document.createElement("p");
  p.id = "chart-error";
  p.setAttribute("role", "alert");
  p.textContent = message;
  wrap.append(p);
  document.body.dataset.error = "true";
}

async function main() {
  const params = new URLSearchParams(location.search);
  const useFixture = params.get("fixture") === "1";
  const data = await loadData(useFixture);
  if (useFixture || data.fixture) document.getElementById("fixture-banner").hidden = false;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const store = createStore(data, {
    initialYear: params.get("year") && Number.isFinite(Number(params.get("year"))) ? Number(params.get("year")) : data.years[0],
    facet: params.get("facet") || "prefecture",
    reducedMotion: reduced.matches,
  });
  reduced.addEventListener("change", () => store.setReducedMotion(reduced.matches));

  const wrap = document.getElementById("tiles-wrap");
  const container = document.getElementById("tiles");
  const tiles = createTiles({ container, data, store });
  createReadout({ data, store });
  createFacetToggle({ store });
  createControls({ store });
  createLegend({ data });
  createTooltip({ data, store, tiles, wrap, container });
  createSources({ data });
  createTimeline({
    root: document.getElementById("timeline"), svgEl: document.getElementById("timeline-svg"),
    slider: document.getElementById("year-slider"), data, store,
  });

  tiles.build(store.getState().facet);
  tiles.show(store.getState().yearIndex, { animate: false });
  store.subscribe((s, c) => {
    if (c.type === "facet") {
      tiles.build(s.facet);
      tiles.show(s.yearIndex, { animate: false });
    } else if (c.type === "year") {
      tiles.show(s.yearIndex, { animate: true });
    }
  });

  window.__regions = { store, data };
  document.body.dataset.year = String(store.getState().year);
  document.body.dataset.facet = store.getState().facet;
  document.body.dataset.ready = "true";
}

main().catch((e) => {
  console.warn(e);
  showError(e.message || "読み込みに失敗しました。");
});
