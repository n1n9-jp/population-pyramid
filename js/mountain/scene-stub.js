// scene.js の代わりに使う仮実装（?stub=1）。docs/MOUNTAIN.md §4 と同じ API を持つ。
// canvas に現在の形・カメラ・断面・強調を文字で描くだけで、3D の描画はしない。
export function createMountain({ canvas, data, reducedMotion }) {
  const state = { form: "terrain", camera: "overview", cutYear: null, highlight: [], orbit: false };
  let pickCb = null;
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
    ];
    lines.forEach((t, i) => ctx.fillText(t, 12, 24 + i * 20));
  }

  canvas.addEventListener("click", () => {
    const y = state.cutYear ?? data.yearMax;
    const row = data.byYear.get(y) || data.byYear.get(data.yearMax);
    pickCb?.({ sex: "male", birthYear: row.year - 40, year: row.year, age: 40, value: row.male[40] });
  });
  canvas.addEventListener("pointerleave", () => pickCb?.(null));

  return {
    setForm(form, opts = {}) { state.form = form; draw(); },
    setCamera(preset, opts = {}) { state.camera = preset; draw(); },
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
    getState() { return { form: state.form, camera: state.camera, cutYear: state.cutYear, highlight: [...state.highlight] }; },
    onPick(cb) { pickCb = cb; },
    dispose() { pickCb = null; },
  };
}
