import { ANIM } from "./config.js";

export function createStore(data, { initialYear = 1920, reducedMotion = false } = {}) {
  const { yearMin, yearMax, gaps } = data;
  const state = { year: yearMin, playing: false, focusAge: null, reducedMotion };
  const listeners = new Set();
  let timer = null;

  const emit = (change) => listeners.forEach((fn) => fn(state, change));
  const gapOf = (y) => gaps.find((g) => y >= g.start && y <= g.end);

  function resolveYear(y, direction) {
    y = Math.max(yearMin, Math.min(yearMax, Math.round(Number(y))));
    const gap = gapOf(y);
    if (!gap) return y;
    const dir = direction ?? (y > state.year ? 1 : -1);
    return dir > 0 ? gap.end + 1 : gap.start - 1;
  }

  function nextYear(y) {
    let n = y + 1;
    const g = gapOf(n);
    if (g) n = g.end + 1;
    return n <= yearMax ? n : null;
  }

  function updateUrl() {
    try {
      const u = new URL(location.href);
      u.searchParams.set("year", String(state.year));
      history.replaceState(null, "", u);
    } catch (e) { /* file:// 等では何もしない */ }
  }

  function setYear(y, { direction } = {}) {
    const next = resolveYear(y, direction);
    if (next !== state.year) {
      state.year = next;
      emit({ type: "year" });
      if (!state.playing) updateUrl();
    }
    return state.year;
  }

  function schedule() {
    timer = setTimeout(() => {
      const n = nextYear(state.year);
      if (n === null) return pause();
      setYear(n, { direction: 1 });
      if (n === yearMax) pause();
      else schedule();
    }, ANIM.stepMs);
  }

  function play() {
    if (state.playing) return;
    if (state.year >= yearMax) setYear(yearMin, { direction: 1 });
    state.playing = true;
    emit({ type: "playing" });
    schedule();
  }

  function pause() {
    clearTimeout(timer);
    timer = null;
    if (!state.playing) return;
    state.playing = false;
    emit({ type: "playing" });
    updateUrl();
  }

  function setFocusAge(age) {
    if (state.focusAge === age) return;
    state.focusAge = age;
    emit({ type: "focus" });
  }

  function setReducedMotion(v) {
    state.reducedMotion = v;
    emit({ type: "reducedMotion" });
  }

  state.year = resolveYear(initialYear, -1);
  return {
    getState: () => state,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    setYear, play, pause, setFocusAge, setReducedMotion,
  };
}
