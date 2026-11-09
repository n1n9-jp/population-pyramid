import { wareki, yearMetaText, formatTotal } from "../format.js";
import { GROUPS, TILE } from "./config.js";

const $ = (id) => document.getElementById(id);
const pct1 = (v) => `${(v * 100).toFixed(1)}%`;
const BASIS = { 国勢調査: "国勢調査", 人口調査: "人口調査" };

export function createReadout({ data, store }) {
  const yearEl = $("year-display");
  const warekiEl = $("wareki-display");
  const metaEl = $("year-meta");
  const totalEl = $("total-display");
  const badgesEl = $("badges");
  const listEl = $("notes-list");
  const compact = $("year-compact");

  function render() {
    const { yearIndex } = store.getState();
    const y = data.yearInfo[yearIndex];
    yearEl.textContent = `${y.year}年`;
    compact.textContent = `${y.year}年`;
    warekiEl.textContent = wareki(y.refDate);
    metaEl.textContent = yearMetaText(y, BASIS);
    const nat = data.shares.national[yearIndex];
    totalEl.textContent = `全国 ${formatTotal(nat.total)}・65歳以上 ${pct1(nat.pct65)}`;
    badgesEl.replaceChildren();
    listEl.replaceChildren();
    for (const id of y.noteIds) {
      const n = data.notes[id];
      if (n.kind === "badge") {
        const b = document.createElement("span");
        b.className = "badge";
        b.dataset.note = id;
        b.title = n.text;
        b.textContent = n.short;
        badgesEl.append(b);
      }
      const li = document.createElement("li");
      li.dataset.note = id;
      li.textContent = n.text;
      listEl.append(li);
    }
    document.body.dataset.year = String(y.year);
  }
  store.subscribe((_s, c) => { if (c.type === "year") render(); });
  render();
}

export function createFacetToggle({ store }) {
  const root = $("facet-toggle");
  const buttons = [...root.querySelectorAll("button[data-facet]")];
  function render() {
    const f = store.getState().facet;
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.facet === f));
    document.body.dataset.facet = f;
  }
  for (const b of buttons) b.addEventListener("click", () => store.setFacet(b.dataset.facet));
  store.subscribe((_s, c) => { if (c.type === "facet") render(); });
  render();
}

export function createControls({ store }) {
  const play = $("btn-play");
  const rewind = $("btn-rewind");
  const yearEl = $("year-display");
  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  function render() {
    const p = store.getState().playing;
    play.setAttribute("aria-label", p ? "一時停止" : "再生");
    play.innerHTML = p ? ICON_PAUSE : ICON_PLAY;
    yearEl.setAttribute("aria-live", p ? "off" : "polite");
  }
  play.addEventListener("click", () => (store.getState().playing ? store.pause() : store.play()));
  rewind.addEventListener("click", () => {
    store.pause();
    store.setIndex(0);
  });
  store.subscribe((_s, c) => { if (c.type === "playing") render(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) store.pause(); });
  render();
}

/**
 * 凡例：男女の色、全国の参照線、共通の横軸（目盛りは1つだけ）。
 * 軸の片側の幅は、描画中のタイルの片側の実寸（px）に合わせ、update() のたびに描き直す。
 */
export function createLegend({ data, container }) {
  const d3 = window.d3;
  const svg = d3.select($("legend-axis"));
  const PAD = 16, H = 44;

  function tileHalfPx() {
    const el = container.querySelector(".tile-svg");
    const w = el ? el.getBoundingClientRect().width : 0;
    return w > 0 ? (TILE.halfWidth * w) / TILE.width : null;
  }

  function update() {
    const half = tileHalfPx();
    if (half == null) return;
    const W = Math.ceil(2 * half + 2 * PAD), cx = W / 2;
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${W} ${H}`).attr("width", W).attr("height", H).attr("data-half-px", half.toFixed(2));
    const x = d3.scaleLinear().domain([0, data.xMaxShare]).range([0, half]);
    const step = data.xMaxShare >= 0.06 ? 0.025 : data.xMaxShare >= 0.03 ? 0.01 : 0.005;
    svg.append("line").attr("class", "axis-line").attr("x1", cx - half).attr("x2", cx + half).attr("y1", 10).attr("y2", 10);
    for (let v = 0; v <= data.xMaxShare + 1e-9; v += step) {
      for (const s of v === 0 ? [0] : [-1, 1]) {
        const px = cx + s * x(v);
        svg.append("line").attr("class", "axis-tick").attr("x1", px).attr("x2", px).attr("y1", 6).attr("y2", 14);
        svg.append("text").attr("class", "axis-text").attr("x", px).attr("y", 28).attr("text-anchor", "middle")
          .text(`${+(v * 100).toFixed(1)}`);
      }
    }
    svg.append("text").attr("class", "axis-text").attr("x", cx).attr("y", 41).attr("text-anchor", "middle")
      .text("総人口に占める割合（%）");
  }

  new ResizeObserver(update).observe(container);
  update();
  return { update };
}

export function createTooltip({ data, store, tiles, wrap, container }) {
  const tip = $("tooltip");
  let shown = null; // {id, group}

  function ageText(g, sh, kazoe) {
    const lo = Number(data.ageGroups[g].split(/[-+]/)[0]);
    if (kazoe) {
      // 数え年は 0〜4 の段が数え年1〜5歳（上位区分は 86歳以上 など）
      return g === sh.open ? `数え年${lo + 1}歳以上` : `数え年${lo + 1}〜${lo + 5}歳`;
    }
    return g === sh.open ? `${lo}歳以上` : `${lo}〜${lo + 4}歳`;
  }

  function content(id, group) {
    const { yearIndex } = store.getState();
    const info = data.yearInfo[yearIndex];
    const sh = data.shares[id][yearIndex];
    const item = data.facets[store.getState().facet].find((a) => a.id === id);
    const frag = document.createDocumentFragment();
    const add = (cls, text, tag = "div") => {
      const e = document.createElement(tag);
      e.className = cls;
      e.textContent = text;
      frag.append(e);
      return e;
    };
    add("tip-head", item.full, "strong");
    if (sh.missing) { add("tip-null", "この年はデータがありません"); return frag; }
    add("tip-birth", `総人口 ${formatTotal(sh.total)}・65歳以上 ${pct1(sh.pct65)}`);
    if (group == null) return frag;
    const h = add("tip-age", ageText(group, sh, info.kazoe));
    h.style.fontWeight = "700";
    if (group > sh.open) { add("tip-null", `${ageText(sh.open, sh, info.kazoe)}にまとめて表示`); return frag; }
    for (const [cls, label, v] of [["male", "男性", sh.m[group]], ["female", "女性", sh.f[group]]]) {
      const row = document.createElement("div");
      row.className = `tip-row tip-${cls}`;
      const sw = document.createElement("i");
      sw.className = "swatch";
      const l = document.createElement("span");
      l.textContent = label;
      const n = document.createElement("span");
      n.className = "tip-num";
      n.textContent = pct1(v);
      row.append(sw, l, n);
      frag.append(row);
    }
    return frag;
  }

  function groupAt(tileEl, e) {
    const r = tileEl.querySelector("svg").getBoundingClientRect();
    if (e.clientY < r.top || e.clientY > r.bottom) return null;
    const row = Math.min(GROUPS - 1, Math.floor(((e.clientY - r.top) / r.height) * GROUPS));
    return GROUPS - 1 - row;
  }

  function show(tileEl, e) {
    const id = tileEl.dataset.area;
    const group = groupAt(tileEl, e);
    shown = { id, group };
    tip.replaceChildren(content(id, group));
    tip.hidden = false;
    const r = wrap.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = px + 14;
    if (x + w > r.width) x = px - w - 14;
    x = Math.max(0, Math.min(r.width - w, x));
    let y = py - h - 12;
    if (y < 0) y = py + 18;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  function hide() {
    shown = null;
    tip.hidden = true;
  }

  container.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    const t = e.target.closest(".tile");
    if (t) show(t, e); else hide();
  });
  container.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") hide(); });
  container.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    const t = e.target.closest(".tile");
    if (!t) return hide();
    const group = groupAt(t, e);
    if (shown && shown.id === t.dataset.area && shown.group === group) return hide();
    show(t, e);
  });
  document.addEventListener("pointerdown", (e) => { if (!wrap.contains(e.target)) hide(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  store.subscribe((_s, c) => {
    if (c.type === "playing" && store.getState().playing) hide();
    if (c.type === "facet") hide();
    if (c.type === "year" && shown) tip.replaceChildren(content(shown.id, shown.group));
  });
}

export function createSources({ data }) {
  $("attribution").textContent = data.attribution;
  const ul = $("source-list");
  for (const [id, s] of Object.entries(data.sources)) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = s.url; a.rel = "noopener";
    // 同じ題名の表を区別できるよう、表番号（「第3表」など）を含める
    const num = /^第[0-9０-９－-]+表/.exec(s.table);
    a.textContent = num ? `${s.title} ${num[0]}` : s.title;
    li.append(a, document.createTextNode(`（${s.table}）`));
    li.dataset.source = id;
    ul.append(li);
  }
}
