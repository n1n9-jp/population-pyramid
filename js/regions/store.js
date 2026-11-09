import { ANIM, FACETS } from "./config.js";

export function createStore(data, { initialYear = data.years[0], facet = "prefecture", reducedMotion = false } = {}) {
  const last = data.years.length - 1;
  const state = { yearIndex: 0, year: data.years[0], facet: "prefecture", playing: false, reducedMotion };
  const listeners = new Set();
  let timer = null;

  const emit = (type) => listeners.forEach((fn) => fn(state, { type }));

  function nearestIndex(y) {
    y = Number(y);
    let best = 0;
    data.years.forEach((v, i) => { if (Math.abs(v - y) < Math.abs(data.years[best] - y)) best = i; });
    return best;
  }

  function updateUrl() {
    try {
      const u = new URL(location.href);
      u.searchParams.set("year", String(state.year));
      u.searchParams.set("facet", state.facet);
      history.replaceState(null, "", u);
    } catch (e) { /* file:// 等では何もしない */ }
  }

  function setIndex(i) {
    i = Math.max(0, Math.min(last, i));
    if (i === state.yearIndex) return state.year;
    state.yearIndex = i;
    state.year = data.years[i];
    emit("year");
    if (!state.playing) updateUrl();
    return state.year;
  }

  const setYear = (y) => setIndex(nearestIndex(y));

  function setFacet(f) {
    if (!FACETS.includes(f) || f === state.facet) return;
    state.facet = f;
    emit("facet");
    if (!state.playing) updateUrl();
  }

  function schedule() {
    timer = setTimeout(() => {
      setIndex(state.yearIndex + 1);
      if (state.yearIndex >= last) pause();
      else schedule();
    }, ANIM.stepMs);
  }

  function play() {
    if (state.playing) return;
    if (state.yearIndex >= last) setIndex(0);
    state.playing = true;
    emit("playing");
    schedule();
  }

  function pause() {
    clearTimeout(timer);
    timer = null;
    if (!state.playing) return;
    state.playing = false;
    emit("playing");
    updateUrl();
  }

  function setReducedMotion(v) {
    state.reducedMotion = v;
    emit("reducedMotion");
  }

  state.yearIndex = nearestIndex(initialYear);
  state.year = data.years[state.yearIndex];
  if (FACETS.includes(facet)) state.facet = facet;

  return {
    getState: () => state,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    setYear, setIndex, setFacet, play, pause, setReducedMotion,
  };
}
