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

// 強調する世代の名前（凡例に出す）
export const COHORT_LABELS = {
  dankai: { name: "団塊の世代", range: "1947〜49年生まれ" },
  hinoeuma: { name: "丙午", range: "1966年生まれ" },
  "dankai-jr": { name: "団塊ジュニア", range: "1971〜74年生まれ" },
  postwar: { name: "終戦前後", range: "1945〜46年生まれ" },
};

// canvas の aria-label（段に合わせる）
const BASE = "人口の山脈の3D表示。横が年、奥行きが年齢、高さが人数";
export const CANVAS_LABELS = {
  overview: `${BASE}。全体の眺め`,
  war: `${BASE}。1941〜43年の推計のない時期と、終戦前後の世代`,
  dankai: `${BASE}。団塊の世代（1947〜49年生まれ）の糸`,
  hinoeuma: `${BASE}。丙午（1966年生まれ）の糸`,
  "dankai-jr": `${BASE}。団塊ジュニア（1971〜74年生まれ）の糸`,
  cut2025: `${BASE}。2025年の断面から人口ピラミッドになる`,
  free: `${BASE}。自由に動かせる表示。ドラッグで回転、ホイールで拡大・縮小`,
};
export const STEP_ORDER = Object.keys(STEPS);
const THEN_DELAY_MS = 800;

/**
 * @param scene  createMountain の戻り値
 * @param free   { getCut(), getHighlight(), setCut(y), setForm(f) }  free の状態を持つ ui
 */
export function createTour({ scene, free, reducedMotion, legend }) {
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
    if (canvas) {
      canvas.dataset.free = String(on);
      if (on) canvas.tabIndex = 0; else canvas.removeAttribute("tabindex");
    }
    scene.setOrbit(on);
  }

  function applyStep(id, { animate: anim = animate } = {}) {
    const s = STEPS[id];
    if (!s || id === current) return;
    clearTimeout(timer);
    free.onStep?.(id);
    current = id;
    document.body.dataset.step = id;
    const cv = document.getElementById("mountain-canvas");
    if (cv && CANVAS_LABELS[id]) cv.setAttribute("aria-label", CANVAS_LABELS[id]);
    const opts = { animate: anim };
    setOrbit(!!s.orbit);
    const target = s.then && reducedMotion ? { ...s, ...s.then } : s;
    const cut = id === "free" ? free.getCut() : s.cut;
    scene.setCutYear(cut);
    if (id !== "free") free.onCut(cut);
    setForm(target.form ?? form, opts);
    scene.setCamera(target.camera, opts);
    const hl = s.highlight ?? free.getHighlight();
    scene.setHighlight(hl);
    legend?.setHighlight(hl);
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
