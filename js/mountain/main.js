import { DATA_PATH, FIXTURE_PATH } from "../config.js";
import { createInset } from "./inset.js";
import { createTour, observeSteps, STEPS } from "./tour.js";
import { createFreeUI, createNotes, createPickTooltip, createSources, fillCalc } from "./ui.js";

const $ = (id) => document.getElementById(id);

async function loadData(useFixture) {
  const url = useFixture ? FIXTURE_PATH : DATA_PATH;
  let res;
  try {
    res = await fetch(new URL(`../../${url}`, import.meta.url));
  } catch {
    throw new Error(`データ（${url}）を読み込めませんでした。リポジトリ直下で python3 -m http.server 8000 を実行して開いてください。`);
  }
  if (!res.ok) throw new Error(`データ（${url}）を読み込めませんでした（HTTP ${res.status}）。`);
  const data = await res.json();
  data.byYear = new Map(data.years.map((y) => [y.year, y]));
  return data;
}

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext(); // 判定用のコンテキストを解放する
    return true;
  } catch { return false; }
}

// WebGL が使えないとき、状態だけを持つ scene（API は MOUNTAIN.md §4 と同じ）
function createNullScene() {
  const s = { form: "terrain", camera: "overview", cutYear: null, highlight: [] };
  return {
    setForm: (f) => { s.form = f; }, setCamera: (c) => { s.camera = c; },
    setCutYear: (y) => { s.cutYear = y; }, setHighlight: (ids) => { s.highlight = [...ids]; },
    setOrbit() {}, resize() {}, onPick() {}, dispose() {},
    getState: () => ({ ...s, highlight: [...s.highlight] }),
  };
}

function showFallback(reason) {
  if (reason) console.warn(reason);
  $("webgl-fallback").hidden = false;
  $("mountain-canvas").hidden = true;
  document.body.dataset.fallback = "true";
}

function showError(message) {
  const p = document.createElement("p");
  p.id = "chart-error";
  p.setAttribute("role", "alert");
  p.textContent = message;
  $("stage").replaceChildren(p);
  document.body.dataset.error = "true";
}

async function createScene({ canvas, data, reducedMotion, useStub }) {
  if (useStub) {
    const m = await import("./scene-stub.js");
    return m.createMountain({ canvas, data, reducedMotion });
  }
  if (!hasWebGL()) { showFallback("WebGL を使えません。"); return createNullScene(); }
  try {
    const m = await import("./scene.js");
    return m.createMountain({ canvas, data, reducedMotion });
  } catch (e) {
    showFallback(`3D シーンを作れませんでした: ${e.message}`);
    return createNullScene();
  }
}

async function main() {
  const params = new URLSearchParams(location.search);
  const useFixture = params.get("fixture") === "1";
  const data = await loadData(useFixture);
  if (useFixture || data.fixture) $("fixture-banner").hidden = false;

  const rm = window.matchMedia("(prefers-reduced-motion: reduce)");
  const reducedMotion = rm.matches;
  const canvas = $("mountain-canvas");
  const stage = $("stage");
  const scene = await createScene({ canvas, data, reducedMotion, useStub: params.get("stub") === "1" });

  const sizeScene = () => {
    const r = stage.getBoundingClientRect();
    if (r.width && r.height) scene.resize(Math.round(r.width), Math.round(r.height));
  };
  sizeScene();
  new ResizeObserver(sizeScene).observe(stage);

  createSources({ data });
  fillCalc(data);
  createNotes({ data });
  const inset = createInset({ root: $("inset"), data });
  let tour = null;
  const free = createFreeUI({ data, scene, inset, getStep: () => tour?.getStep() });
  tour = createTour({ scene, free, reducedMotion });
  free.attach(tour);
  createPickTooltip({ data, scene, stage, canvas });

  const steps = [...document.querySelectorAll(".scene-step[data-step]")];
  const requested = params.get("step");
  const first = requested && STEPS[requested] ? requested : "overview";
  tour.applyStep(first, { animate: false });
  if (requested && STEPS[requested]) {
    const target = steps.find((s) => s.dataset.step === first);
    if (first !== "overview") target?.scrollIntoView({ block: "start", behavior: "instant" });
  }
  observeSteps({ steps, onStep: (id) => tour.applyStep(id) });

  window.__mountain = { scene, data };
  document.body.dataset.ready = "true";
}

main().catch((e) => {
  console.warn(e);
  showError(e.message || "読み込みに失敗しました。");
});
