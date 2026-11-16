// スクロールツアー。docs/MOUNTAIN.md §5 の表のとおり、段ごとに scene を切り替える。
export const ALL_COHORTS = ["dankai", "hinoeuma", "dankai-jr", "postwar"];

export const STEPS = {
  overview: { form: "terrain", camera: "overview", highlight: ALL_COHORTS, cut: null },
  war: { form: "terrain", camera: "war", highlight: ["postwar"], cut: null },
  dankai: { form: "terrain", camera: "dankai", highlight: ["dankai"], cut: null },
  hinoeuma: { form: "terrain", camera: "hinoeuma", highlight: ["hinoeuma"], cut: null },
  "dankai-jr": { form: "terrain", camera: "dankai-jr", highlight: ["dankai-jr"], cut: null },
  // terrain（cut2025）→ pyramid（pyramid-front）。後半は dwell 後に切り替える
  cut2025: { form: "terrain", camera: "cut2025", highlight: ALL_COHORTS, cut: 2025, then: { form: "pyramid", camera: "pyramid-front" } },
  free: { form: null, camera: "free", highlight: null, cut: null, orbit: true },
};
export const STEP_ORDER = Object.keys(STEPS);
const THEN_DELAY_MS = 800;

/**
 * @param scene  createMountain の戻り値
 * @param free   { getCut(), getHighlight(), setCut(y), setForm(f) }  free の状態を持つ ui
 */
export function createTour({ scene, free, reducedMotion }) {
  const animate = !reducedMotion;
  let current = null;
  let form = "terrain";
  let timer = null;
  let orbit = false;

  const setForm = (f, opts) => {
    form = f;
    document.body.dataset.form = f;
    scene.setForm(f, opts);
    free.onForm(f);
  };

  function setOrbit(on) {
    if (orbit === on) return;
    orbit = on;
    const canvas = document.getElementById("mountain-canvas");
    if (canvas) canvas.dataset.free = String(on);
    scene.setOrbit(on);
  }

  function applyStep(id, { animate: anim = animate } = {}) {
    const s = STEPS[id];
    if (!s || id === current) return;
    clearTimeout(timer);
    current = id;
    document.body.dataset.step = id;
    const opts = { animate: anim };
    setOrbit(!!s.orbit);
    const target = s.then && reducedMotion ? { ...s, ...s.then } : s;
    const cut = id === "free" ? free.getCut() : s.cut;
    scene.setCutYear(cut);
    if (id !== "free") free.onCut(cut);
    setForm(target.form ?? form, opts);
    scene.setCamera(target.camera, opts);
    scene.setHighlight(s.highlight ?? free.getHighlight());
    if (s.then && !reducedMotion) {
      timer = setTimeout(() => {
        if (current !== id) return;
        setForm(s.then.form, opts);
        scene.setCamera(s.then.camera, opts);
      }, THEN_DELAY_MS);
    }
  }

  return {
    applyStep,
    setForm: (f) => setForm(f, { animate }),
    getStep: () => current,
    getForm: () => form,
  };
}

/** 画面中央付近に入った段を current として通知する */
export function observeSteps({ steps, onStep }) {
  let io = null;
  const mq = window.matchMedia("(max-width: 899px)");
  function build() {
    io?.disconnect();
    // 狭い画面は上の canvas に隠れない下側の帯、広い画面は中央の帯で判定する
    const margin = mq.matches ? "-62% 0px -22% 0px" : "-42% 0px -42% 0px";
    io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) onStep(e.target.dataset.step);
    }, { rootMargin: margin, threshold: 0 });
    steps.forEach((s) => io.observe(s));
  }
  build();
  mq.addEventListener("change", build);
  return { disconnect: () => io?.disconnect() };
}
