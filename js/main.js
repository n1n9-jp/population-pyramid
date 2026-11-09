import { loadData } from "./data.js";
import { createStore } from "./store.js";
import { createChart } from "./chart.js";
import { createTimeline } from "./timeline.js";
import { createReadout, createDataTable, createTooltip, createControls, createSources } from "./ui.js";

function showError(message) {
  const wrap = document.getElementById("chart-wrap");
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
  const yearParam = Number(params.get("year"));
  const store = createStore(data, {
    initialYear: Number.isFinite(yearParam) && params.get("year") ? yearParam : data.yearMin,
    reducedMotion: reduced.matches,
  });
  reduced.addEventListener("change", () => store.setReducedMotion(reduced.matches));

  const wrap = document.getElementById("chart-wrap");
  const chart = createChart({
    svg: document.getElementById("chart"), wrap,
    calloutHost: document.getElementById("callout-layer"), data, store,
  });
  createReadout({ data, store });
  createDataTable({ data, store });
  createTooltip({ data, store, chart, wrap });
  createControls({ store });
  createSources({ data });
  createTimeline({
    root: document.getElementById("timeline"), svgEl: document.getElementById("timeline-svg"),
    slider: document.getElementById("year-slider"), data, store,
  });

  chart.showYear(store.getState().year, { animate: false });
  store.subscribe((_s, c) => { if (c.type === "year") chart.showYear(store.getState().year); });

  // 読み出しと操作部が配置されてから、1画面に収まる行の高さに合わせる
  chart.refit();
  document.fonts?.ready.then(() => chart.refit());

  window.__app = { store, data, layout: chart.layout };
  document.body.dataset.year = String(store.getState().year);
  document.body.dataset.ready = "true";
}

main().catch((e) => {
  console.warn(e);
  showError(e.message || "読み込みに失敗しました。");
});
