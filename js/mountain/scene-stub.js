// scene.js の代わりに使う仮実装（?stub=1）。docs/MOUNTAIN.md §4 と同じ API を持つ。
// canvas に現在の形・カメラ・断面・強調を文字で描くだけで、3D の描画はしない。
export function createMountain({ canvas, data, reducedMotion }) {
  const state = { form: "terrain", camera: "overview", cutYear: null, highlight: [], orbit: false };
  let pickCb = null;
  let flight = null; // { cohort, progress, timer, onEnd }
  const COHORTS = { dankai: [1947, 1949], hinoeuma: [1966, 1966], "dankai-jr": [1971, 1974], postwar: [1945, 1946] };
  let w = 0, h = 0;
  const ctx = canvas.getContext("2d");

  function draw() {
    if (!ctx || !w) return;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#f4f0e6";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = state.form === "terrain" ? "#9db9d9" : "#ffc56e";
    ctx.beginPath();
    if (state.form === "terrain") {
      ctx.moveTo(w * 0.1, h * 0.7); ctx.lineTo(w * 0.8, h * 0.7); ctx.lineTo(w * 0.9, h * 0.35); ctx.lineTo(w * 0.2, h * 0.35);
    } else {
      ctx.moveTo(w * 0.5, h * 0.2); ctx.lineTo(w * 0.8, h * 0.8); ctx.lineTo(w * 0.2, h * 0.8);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#2a2620";
    ctx.font = "14px sans-serif";
    const lines = [
      "STUB（3D 描画なし）",
      `form: ${state.form}`,
      `camera: ${state.camera}${state.orbit ? "（orbit）" : ""}`,
      `cutYear: ${state.cutYear ?? "なし"}`,
      `highlight: ${state.highlight.join(", ") || "なし"}`,
      `flight: ${flight ? `${flight.cohort} ${Math.round(flight.progress * 100)}%` : "なし"}`,
    ];
    lines.forEach((t, i) => ctx.fillText(t, 12, 24 + i * 20));
  }

  canvas.addEventListener("click", () => {
    const y = state.cutYear ?? data.yearMax;
    const row = data.byYear.get(y) || data.byYear.get(data.yearMax);
    pickCb?.({ sex: "male", birthYear: row.year - 40, year: row.year, age: 40, value: row.male[40] });
  });
  canvas.addEventListener("pointerleave", () => pickCb?.(null));
  canvas.addEventListener("pointerdown", () => { if (flight) endFlight("user"); }, { capture: true });

  // 仮のフライト：時間で progress を進め、生まれ年（中央の年）から最終年までの年を返す
  function infoAt(cohort, p) {
    const [from, to] = COHORTS[cohort];
    const b = Math.round((from + to) / 2);
    let year = Math.round(b + (data.yearMax - b) * p);
    while (!data.byYear.has(year) && year < data.yearMax) year++;
    const row = data.byYear.get(year);
    const age = year - b + (row.kazoe ? 1 : 0);
    return { cohort, progress: p, birthYear: b, year, age, value: row.male[age] ?? null, kazoe: !!row.kazoe };
  }
  function endFlight(reason) {
    const f = flight; if (!f) return;
    flight = null; clearInterval(f.timer); draw();
    f.onEnd?.({ reason, cohort: f.cohort });
  }
  return {
    setForm(form, opts = {}) { if (form !== "terrain" && flight) endFlight("stop"); state.form = form; draw(); },
    setCamera(preset, opts = {}) { if (flight) endFlight("stop"); state.camera = preset; draw(); },
    setCutYear(year) { state.cutYear = year; draw(); },
    setHighlight(ids) { state.highlight = [...ids]; draw(); },
    setOrbit(enabled) { state.orbit = !!enabled; draw(); },
    resize(nw, nh) {
      w = nw; h = nh;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    },
    getState() {
      const fl = flight ? { cohort: flight.cohort, progress: flight.progress, year: flight.year, age: flight.age, clearance: 1 } : null;
      return { form: state.form, camera: state.camera, cutYear: state.cutYear, highlight: [...state.highlight], flight: fl };
    },
    fly(cohort, { duration = 12000, onProgress, onEnd } = {}) {
      if (!COHORTS[cohort]) throw new Error("unknown cohort: " + cohort);
      if (flight) endFlight("stop");
      state.form = "terrain";
      if (reducedMotion) { onProgress?.(infoAt(cohort, 0.5)); onEnd?.({ reason: "reduced", cohort }); return; }
      const t0 = performance.now();
      const f = { cohort, progress: 0, onEnd, year: null, age: null };
      f.timer = setInterval(() => {
        f.progress = Math.min(1, (performance.now() - t0) / duration);
        const info = infoAt(cohort, f.progress);
        f.year = info.year; f.age = info.age;
        onProgress?.(info); draw();
        if (f.progress >= 1) endFlight("end");
      }, 50);
      flight = f; draw();
    },
    stopFlight() { endFlight("stop"); },
    onPick(cb) { pickCb = cb; },
    dispose() { pickCb = null; if (flight) { clearInterval(flight.timer); flight = null; } },
  };
}
