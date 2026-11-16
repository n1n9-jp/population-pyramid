// free の UI（形・断面・世代）、ツールチップ、データ表、出典欄。
import { ageHeading, ageLabel, formatPersons, formatTotal, wareki } from "../format.js";
import { COHORT_LABELS } from "./tour.js";

const $ = (id) => document.getElementById(id);
const comma = (v) => Math.round(v).toLocaleString("en-US");

export function createFreeUI({ data, scene, inset, getStep, legend }) {
  const slider = $("cut-slider");
  const out = $("cut-year-out");
  const note = $("cut-note");
  const toggle = $("form-toggle");
  const cohortBox = $("cohort-select");
  const { yearMin, yearMax, gaps } = data;
  let tour = null;
  let year = yearMax;
  let lastRaw = yearMax;

  const SVGNS = "http://www.w3.org/2000/svg";
  const ticks = $("cut-ticks");
  const timelineBox = $("cut-timeline");
  const playBtn = $("btn-cut-play");
  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  const RAIL_Y = 34; // スライダー（top 20px・高さ 28px）の中心
  const THUMB_HALF = 16; // 余白 8px + つまみ幅の半分 8px
  let width = 0;
  let pill = null, pillText = null;
  const el = (name, attrs, parent = ticks) => {
    const e = document.createElementNS(SVGNS, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent.append(e);
    return e;
  };
  const xOf = (y) => THUMB_HALF + ((y - yearMin) / (yearMax - yearMin)) * (width - 2 * THUMB_HALF);

  // 左から塗らない一様なレール、目盛り、端の年、推計なしの網掛け。選んだ年はつまみとラベルで示す
  function drawTimeline() {
    width = timelineBox.clientWidth;
    ticks.replaceChildren();
    if (!width) return;
    const unit = (width - 2 * THUMB_HALF) / (yearMax - yearMin);
    const defs = el("defs", {});
    const pat = el("pattern", { id: "cut-gap-hatch", width: 5, height: 5, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
    el("line", { x1: 0, x2: 0, y1: 0, y2: 5, class: "cut-hatch" }, pat);
    el("line", { class: "cut-rail", x1: xOf(yearMin), x2: xOf(yearMax), y1: RAIL_Y, y2: RAIL_Y });
    for (let y = yearMin; y <= yearMax; y++) {
      if (gapOf(y)) continue;
      const end = y === yearMin || y === yearMax;
      if (y % 10 !== 0 && !end) continue;
      el("line", { class: "cut-tick", x1: xOf(y), x2: xOf(y), y1: RAIL_Y + 3, y2: RAIL_Y + (y % 10 === 0 ? 10 : 7) });
      const every = width < 420 ? 20 : 10;
      const farFromEnds = xOf(y) - xOf(yearMin) >= 34 && xOf(yearMax) - xOf(y) >= 34;
      if (end || (y % every === 0 && farFromEnds)) {
        const t = el("text", { x: xOf(y), y: 60, "text-anchor": y === yearMin ? "start" : y === yearMax ? "end" : "middle" });
        t.textContent = y;
        if (y === yearMin) t.setAttribute("x", Math.max(0, xOf(y) - 8));
        if (y === yearMax) t.setAttribute("x", Math.min(width, xOf(y) + 8));
      }
    }
    for (const g of gaps) {
      const x0 = xOf(g.start) - unit / 2, x1 = xOf(g.end) + unit / 2;
      el("rect", { class: "cut-gap", x: x0, y: RAIL_Y - 8, width: x1 - x0, height: 16, fill: "url(#cut-gap-hatch)" });
    }
    pill = el("rect", { class: "cut-pill", y: 1, height: 18, rx: 9 });
    pillText = el("text", { class: "cut-year-label", y: 14, "text-anchor": "middle" });
    placeLabel();
  }
  function placeLabel() {
    if (!pill || !width) return;
    pillText.textContent = `${year}年`;
    const w = 58;
    const cx = Math.max(w / 2, Math.min(width - w / 2, xOf(year)));
    pill.setAttribute("x", cx - w / 2); pill.setAttribute("width", w);
    pillText.setAttribute("x", cx);
  }

  slider.min = yearMin; slider.max = yearMax; slider.step = 1; slider.value = year;

  const gapOf = (y) => gaps.find((g) => y >= g.start && y <= g.end);
  // データのない年は、移動の向きで解決する（全国ページと同じ）
  function resolve(y, dir) {
    const g = gapOf(y);
    if (!g) return y;
    return dir > 0 ? g.end + 1 : g.start - 1;
  }

  function showYear(y, message = "") {
    year = y;
    slider.value = y;
    placeLabel();
    const row = data.byYear.get(y);
    out.textContent = `${y}年（${wareki(row.refDate)}）`;
    slider.setAttribute("aria-valuetext", `${y}年${row.kazoe ? "（数え年）" : ""}`);
    note.textContent = message || (row.kazoe ? "この年の年齢は数え年です。" : "");
    inset.render(y);
    renderTable(data, y);
    renderYearNotes(data, y);
  }

  // ---- 再生 ----
  const PLAY_MS = 400;
  let playing = false;
  let playTimer = 0;
  function setPlaying(on) {
    playing = on;
    clearTimeout(playTimer);
    playTimer = 0;
    playBtn.innerHTML = on ? ICON_PAUSE : ICON_PLAY;
    playBtn.setAttribute("aria-label", on ? "一時停止" : "再生");
    out.setAttribute("aria-live", on ? "off" : "polite");
    note.setAttribute("aria-live", on ? "off" : "polite");
  }
  function stop() { if (playing) setPlaying(false); }
  function goto(y) {
    showYear(y);
    if (getStep() === "free") scene.setCutYear(y);
  }
  function tick() {
    playTimer = 0;
    if (!playing) return;
    if (getStep() !== "free") { stop(); return; }
    const next = resolve(year + 1, 1);
    if (next > yearMax) { stop(); return; }
    goto(next);
    lastRaw = next;
    if (next >= yearMax) stop();
    else playTimer = setTimeout(tick, PLAY_MS);
  }
  function start() {
    if (year >= yearMax) { goto(yearMin); lastRaw = yearMin; }
    setPlaying(true);
    playTimer = setTimeout(tick, PLAY_MS);
  }
  playBtn.addEventListener("click", () => { if (playing) stop(); else start(); });
  $("btn-cut-rewind").addEventListener("click", () => {
    stop();
    if (pending) { pending = null; cancelAnimationFrame(raf); raf = 0; }
    goto(yearMin);
    lastRaw = yearMin;
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
  setPlaying(false);

  function setCutFromUser(y, dir) {
    const r = resolve(y, dir);
    const g = gapOf(y);
    showYear(r, g ? `${g.start}〜${g.end}年は推計がないため、${r}年を表示しています。` : "");
    if (getStep() === "free") scene.setCutYear(r);
  }

  // 重い描画（小窓・表・scene）は requestAnimationFrame で間引く。向きは入力ごとに決める
  let pending = null;
  let raf = 0;
  const flush = () => {
    raf = 0;
    if (!pending) return;
    const { v, dir } = pending;
    pending = null;
    setCutFromUser(v, dir);
  };
  slider.addEventListener("input", () => {
    stop();
    const v = Number(slider.value);
    const dir = v >= lastRaw ? 1 : -1;
    lastRaw = v; // ドラッグ中は生の値を持つ（全国ページの timeline.js と同じ）
    pending = { v, dir };
    if (!raf) raf = requestAnimationFrame(flush);
  });
  slider.addEventListener("change", () => { if (raf) { cancelAnimationFrame(raf); flush(); } });
  // キー操作は現在値（解決後）からの±1なので、基準も現在値に合わせる
  slider.addEventListener("keydown", () => { lastRaw = year; stop(); });
  slider.addEventListener("pointerdown", stop);

  toggle.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-form]");
    if (b && tour) tour.setForm(b.dataset.form);
  });

  const selected = () => [...cohortBox.querySelectorAll("input[data-cohort]")].filter((i) => i.checked).map((i) => i.dataset.cohort);
  cohortBox.addEventListener("change", () => {
    if (getStep() !== "free") return;
    scene.setHighlight(selected());
    legend?.setHighlight(selected());
  });
  // 視点を戻す（scene に resetView があればそれを、なければ free のプリセットに戻す）
  $("btn-reset-view")?.addEventListener("click", () => {
    if (getStep() !== "free") return;
    const animate = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (typeof scene.resetView === "function") scene.resetView({ animate });
    else scene.setCamera("free", { animate });
  });

  $("data-details").addEventListener("toggle", () => renderTable(data, year));
  drawTimeline();
  new ResizeObserver(() => { if (timelineBox.clientWidth !== width) drawTimeline(); }).observe(timelineBox);
  showYear(year);
  return {
    attach(t) { tour = t; },
    getCut: () => year,
    onStep(id) { if (id !== "free") stop(); },
    getHighlight: () => selected(),
    onForm(f) {
      toggle.querySelectorAll("button[data-form]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.form === f)));
    },
    // ツアー側が断面を変えたとき（cut2025 段）にスライダーを合わせる
    onCut(c) { if (c != null && c !== year) { lastRaw = c; showYear(c); } },
  };
}

/**
 * 尾根沿いのフライトの UI：飛行中の表示 #flight-hud、flight 段の #btn-fly-again、free の #flight-cohort と #btn-fly。
 * 凡例の「強調している世代」は、飛行中はその世代に合わせ、終わったら scene の強調に戻す。
 */
export function createFlightUI({ scene, legend, getStep, getForm, setForm }) {
  const hud = $("flight-hud");
  const btn = $("btn-fly");
  const select = $("flight-cohort");
  const again = $("btn-fly-again");
  let flying = null;

  function hudText(id, p) {
    const c = COHORT_LABELS[id];
    const k = p.kazoe ? 1 : 0;
    const lo = Math.max(0, p.year - c.to + k), hi = Math.max(0, p.year - c.from + k);
    const ages = lo === hi ? `${hi}歳` : `${lo}〜${hi}歳`;
    return `${c.name}・${p.year}年・${p.kazoe ? "数え年" : ""}${ages}`;
  }
  function setButton() {
    if (btn) btn.textContent = flying && getStep() === "free" ? "止める" : "尾根に沿って飛ぶ";
  }
  function ended() {
    flying = null;
    hud.hidden = true;
    setButton();
    legend?.setHighlight(scene.getState().highlight || []);
  }
  function start(id) {
    if (!COHORT_LABELS[id]) return;
    if (flying) stop();
    // フライトは地形型で飛ぶ。free でピラミッド型のときは、先に形を地形型に戻す（UI の表示も合わせる）
    if (getForm && getForm() !== "terrain") setForm?.("terrain");
    flying = id;
    legend?.setHighlight([id]);
    setButton();
    let last = "";
    scene.fly(id, {
      onProgress: (p) => {
        if (flying !== id) return;
        const t = hudText(id, p);
        if (t !== last) { hud.textContent = t; last = t; }
        hud.hidden = false;
      },
      onEnd: () => { if (flying === id) ended(); },
    });
    // reduced motion などで、すぐ終わったときは表示を出さない
    if (flying !== id) hud.hidden = true;
  }
  function stop() {
    if (!flying) return;
    scene.stopFlight?.();
    if (flying) ended();
  }
  btn?.addEventListener("click", () => {
    if (getStep() !== "free") return;
    if (flying) stop(); else start(select.value);
  });
  again?.addEventListener("click", () => { if (getStep() === "flight") start("dankai"); });
  setButton();
  return { start, stop, isFlying: () => !!flying };
}

function renderTable(data, year) {
  const details = $("data-details");
  if (!details.open) return; // 閉じている間は描かない（開いたとき toggle で描く）
  const y = data.byYear.get(year);
  const tbody = document.querySelector("#data-table tbody");
  $("data-table-caption").textContent = `${year}年の年齢（各歳）・男女別人口（人）`;
  const fmt = (v) => (v == null ? "—" : comma(v));
  const rows = [];
  for (let a = 0; a <= data.ageMax; a++) {
    const m = y.male[a], f = y.female[a];
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = ageLabel(y, a);
    tr.append(th);
    [fmt(m), fmt(f), m == null || f == null ? "—" : fmt(m + f)].forEach((t) => {
      const td = document.createElement("td"); td.textContent = t; tr.append(td);
    });
    rows.push(tr);
  }
  tbody.replaceChildren(...rows);
}

export function createPickTooltip({ data, scene, stage, canvas }) {
  const tip = $("pick-tooltip");
  let pos = { x: 0, y: 0 };
  const track = (e) => {
    const r = stage.getBoundingClientRect();
    pos = { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  canvas.addEventListener("pointermove", track);
  canvas.addEventListener("pointerdown", track);
  // タッチではタップ後に pointerleave が来るので、マウスのときだけ消す
  let lastType = "mouse";
  canvas.addEventListener("pointerdown", (e) => { lastType = e.pointerType || "mouse"; });
  canvas.addEventListener("pointermove", (e) => { lastType = e.pointerType || lastType; });
  canvas.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") tip.hidden = true; });

  scene.onPick((p, info) => {
    if (!p) {
      // タップで何もない所を押したときは消す。タッチ中のホバー由来の null は無視する
      if (info?.type === "tap" || lastType === "mouse") tip.hidden = true;
      return;
    }
    const row = data.byYear.get(p.year);
    const precision = row ? row.precision : 1;
    const sexLabel = p.sex === "male" ? "男性" : "女性";
    const age = row ? ageHeading(row, p.age) : `${p.age}歳`;
    tip.replaceChildren();
    const head = document.createElement("strong");
    head.className = "tip-head";
    head.textContent = `${p.birthYear}年生まれ`;
    const sub = document.createElement("span");
    sub.className = "tip-sub";
    sub.textContent = `${p.year}年・${age}`;
    const val = document.createElement("span");
    val.className = `tip-val tip-${p.sex}`;
    val.textContent = `${sexLabel} ${formatPersons(p.value, precision)}`;
    tip.append(head, sub, val);
    tip.hidden = false;
    const r = stage.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const x = Math.max(4, Math.min(pos.x + 14, r.width - w - 4));
    const y = Math.max(4, Math.min(pos.y + 14, r.height - h - 4));
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  });
}

/** 凡例：強調している世代の名前と、推計なしの年を出す。狭い画面では折りたたむ */
export function createLegend({ data }) {
  const details = $("legend-details");
  const cohortLine = $("legend-cohort");
  const full = $("legend-cohorts-full");
  const gapEl = $("legend-gap");
  if (data.gaps?.length) {
    gapEl.textContent = "推計なし（" + data.gaps.map((g) => (g.start === g.end ? `${g.start}年` : `${g.start}〜${String(g.end).slice(-2)}年`)).join("・") + "）";
  }
  const mq = window.matchMedia("(max-width: 899px)");
  const fit = () => { details.open = !mq.matches; };
  fit();
  mq.addEventListener("change", fit);

  function setHighlight(ids) {
    const list = ids.filter((id) => COHORT_LABELS[id]);
    full.replaceChildren(...list.map((id) => {
      const li = document.createElement("li");
      li.dataset.cohort = id;
      li.textContent = `${COHORT_LABELS[id].name} ${COHORT_LABELS[id].range}`;
      return li;
    }));
    cohortLine.textContent = list.length === 0 ? ""
      : list.length === 1 ? `強調：${COHORT_LABELS[list[0]].name} ${COHORT_LABELS[list[0]].range}`
      : `強調：${list.map((id) => COHORT_LABELS[id].name).join("・")}`;
  }
  return { setHighlight };
}

export function createSources({ data }) {
  $("attribution").textContent = data.attribution;
  const ul = $("source-list");
  for (const [id, s] of Object.entries(data.sources)) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = s.url; a.rel = "noopener"; a.textContent = s.title;
    li.append(a, document.createTextNode(`（${s.table}、単位：${s.unitInSource}）`));
    li.dataset.source = id;
    ul.append(li);
  }
}

/** 解説文中の data-calc の数値を、data から計算した値に置き換える */
export function fillCalc(data) {
  const f = (y) => data.byYear.get(y);
  const pop = (y, a) => (f(y) ? f(y).male[a] + f(y).female[a] : null);
  const sum = (y, a0, a1) => { let s = 0; for (let a = a0; a <= a1; a++) s += pop(y, a); return s; };
  const man = (v) => `${Math.round(v / 1e4).toLocaleString("en-US")}万人`;
  const pct = (v) => `${(Math.round(v * 1000) / 10).toFixed(1)}%`;
  const t = f(data.yearMax);
  const tot = t.total.both;
  const calc = {
    "total-1920": () => formatTotal(f(1920).total.both),
    "total-2025": () => formatTotal(tot),
    "p1950-3": () => man(pop(1950, 3)),
    "p1950-4": () => man(pop(1950, 4)),
    "dankai-2025": () => man(sum(2025, 76, 78)),
    "h-58": () => man(pop(2025, 58)),
    "h-59": () => man(pop(2025, 59)),
    "h-60": () => man(pop(2025, 60)),
    "jr-2025": () => man(sum(2025, 51, 54)),
    s65: () => man(sum(2025, 65, 100)),
    r65: () => pct(sum(2025, 65, 100) / tot),
    r75: () => pct(sum(2025, 75, 100) / tot),
    s14: () => man(sum(2025, 0, 14)),
  };
  document.querySelectorAll("[data-calc]").forEach((el) => {
    const fn = calc[el.dataset.calc];
    if (!fn) return;
    try { el.textContent = fn(); } catch { /* 静的な既定値のまま */ }
  });
}

/** 注記の文言は data.notes から描く。解説文中の [data-note-text] と「見方の注意」の一覧 */
export function createNotes({ data }) {
  document.querySelectorAll("[data-note-text]").forEach((el) => {
    const n = data.notes[el.dataset.noteText];
    if (n) el.textContent = n.text;
  });
  const ul = $("notes-list");
  if (!ul) return;
  for (const [id, n] of Object.entries(data.notes)) {
    const li = document.createElement("li");
    li.dataset.note = id;
    li.textContent = n.text;
    ul.append(li);
  }
}

// 断面の年に当てはまる注記（年に応じて出す）
function renderYearNotes(data, year) {
  const ul = $("year-notes");
  if (!ul) return;
  const row = data.byYear.get(year);
  const ids = (row && row.noteIds) || [];
  ul.replaceChildren(...ids.filter((id) => data.notes[id]).map((id) => {
    const li = document.createElement("li");
    li.dataset.note = id;
    li.textContent = data.notes[id].text;
    return li;
  }));
}
