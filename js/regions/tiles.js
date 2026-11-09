import { ANIM, GROUPS, TILE } from "./config.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_H = GROUPS * TILE.rowH;
const BAR_H = TILE.rowH - 0.6;
const pctText = (p) => `${(p * 100).toFixed(1)}%`;

function svgEl(name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** 階段状の折れ線（下が0歳）。sign=-1 が男性（左）、+1 が女性（右）。last は最後に描く段。 */
function stepPath(widths, sign, last) {
  let d = `M${TILE.center},${VIEW_H}`;
  for (let g = 0; g <= last; g++) {
    d += `H${(TILE.center + sign * widths[g]).toFixed(2)}V${(GROUPS - 1 - g) * TILE.rowH}`;
  }
  return d + `H${TILE.center}`;
}

/**
 * タイル群。DOM を作り直すのは build()（facet の切り替え）だけで、
 * 年の変更は棒の x / width と折れ線の d だけを1本の requestAnimationFrame で動かす。
 */
export function createTiles({ container, data, store }) {
  const d3 = window.d3;
  let tiles = [];      // {id, el, pctEl, bars:[{el, sex, g}], nat:[pathM, pathF]}
  let cur = new Float32Array(0), from = new Float32Array(0), to = new Float32Array(0);
  const natCur = [new Float32Array(GROUPS), new Float32Array(GROUPS)];
  const natFrom = [new Float32Array(GROUPS), new Float32Array(GROUPS)];
  const natTo = [new Float32Array(GROUPS), new Float32Array(GROUPS)];
  let raf = 0;
  let flatBars = []; // 全棒（tile × 36）
  let startTime = 0;

  function build(facet) {
    cancelAnimationFrame(raf);
    raf = 0;
    container.replaceChildren();
    container.className = `tiles facet-${facet}`;
    container.dataset.facet = facet;
    tiles = [];
    const frag = document.createDocumentFragment();
    for (const item of data.facets[facet]) {
      const el = document.createElement("div");
      el.className = "tile";
      el.dataset.area = item.id;
      el.dataset.halfWidth = String(TILE.halfWidth);
      el.setAttribute("role", "img");
      el.style.setProperty("--gx", item.tile.x);
      el.style.setProperty("--gy", item.tile.y);

      const head = document.createElement("div");
      head.className = "tile-head";
      const nameEl = document.createElement("span");
      nameEl.className = "tile-name";
      nameEl.textContent = item.name;
      const pctEl = document.createElement("span");
      pctEl.className = "tile-pct";
      head.append(nameEl, pctEl);

      const svg = svgEl("svg", { viewBox: `0 0 ${TILE.width} ${VIEW_H}`, class: "tile-svg", "aria-hidden": "true", focusable: "false" });
      svg.append(svgEl("line", { class: "center-line", x1: TILE.center, x2: TILE.center, y1: 0, y2: VIEW_H }));
      const bars = [];
      for (const sex of ["male", "female"]) {
        for (let g = 0; g < GROUPS; g++) {
          const rect = svgEl("rect", {
            class: `bar ${sex}`, "data-sex": sex, "data-group": g, "data-value": "",
            x: TILE.center, y: ((GROUPS - 1 - g) * TILE.rowH + 0.3).toFixed(2), width: 0, height: BAR_H,
          });
          svg.append(rect);
          bars.push({ el: rect, sex: sex === "male" ? -1 : 1, g });
        }
      }
      const nat = ["male", "female"].map((sex) => {
        const p = svgEl("path", { class: "national", "data-sex": sex, d: "", fill: "none" });
        svg.append(p);
        return p;
      });
      el.append(head, svg);
      frag.append(el);
      tiles.push({ id: item.id, el, pctEl, svg, bars, nat, item, natLast: GROUPS - 1 });
    }
    container.append(frag);
    flatBars = tiles.flatMap((t) => t.bars);
    const n = flatBars.length;
    cur = new Float32Array(n); from = new Float32Array(n); to = new Float32Array(n);
    for (const a of [natCur, natFrom, natTo]) a.forEach((x) => x.fill(0));
  }

  const widthOf = (v) => (v == null ? 0 : Math.min(1, v / data.xMaxShare) * TILE.halfWidth);

  function paintAll() {
    for (let k = 0; k < flatBars.length; k++) {
      const bar = flatBars[k];
      const w = cur[k];
      if (bar.last !== w) {
        bar.last = w;
        bar.el.setAttribute("width", w.toFixed(2));
        if (bar.sex < 0) bar.el.setAttribute("x", (TILE.center - w).toFixed(2));
      }
    }
    const cache = new Map();
    for (const t of tiles) {
      let ds = cache.get(t.natLast);
      if (!ds) {
        ds = [stepPath(natCur[0], -1, t.natLast), stepPath(natCur[1], 1, t.natLast)];
        cache.set(t.natLast, ds);
      }
      t.nat[0].setAttribute("d", ds[0]);
      t.nat[1].setAttribute("d", ds[1]);
    }
  }

  function frame(now) {
    const t = Math.max(0, Math.min(1, (now - startTime) / ANIM.barMs));
    const e = d3.easeCubicOut(t);
    for (let k = 0; k < cur.length; k++) cur[k] = from[k] + (to[k] - from[k]) * e;
    for (let s = 0; s < 2; s++) for (let g = 0; g < GROUPS; g++) natCur[s][g] = natFrom[s][g] + (natTo[s][g] - natFrom[s][g]) * e;
    paintAll();
    raf = t < 1 ? requestAnimationFrame(frame) : 0;
  }

  function show(yi, { animate = true } = {}) {
    const info = data.yearInfo[yi];
    const nat = data.shares.national[yi];
    let k = 0;
    for (const t of tiles) {
      const sh = data.shares[t.id][yi];
      t.el.classList.toggle("is-missing", sh.missing);
      // 参照線は、全国と地域の上位区分の段のうち低い方の手前まで。区分が同じときだけ上位区分の段も描く
      const lim = Math.min(nat.open, sh.open ?? nat.open);
      t.natLast = nat.open === (sh.open ?? nat.open) ? lim : lim - 1;
      let missingEl = t.el.querySelector(".tile-missing");
      if (sh.missing && !missingEl) {
        missingEl = document.createElement("div");
        missingEl.className = "tile-missing";
        missingEl.textContent = "データなし";
        t.el.append(missingEl);
      } else if (!sh.missing && missingEl) missingEl.remove();
      t.pctEl.textContent = sh.missing ? "—" : pctText(sh.pct65);
      t.el.setAttribute("aria-label", sh.missing
        ? `${t.item.full}（${info.year}年）データなし`
        : `${t.item.full}（${info.year}年）65歳以上 ${pctText(sh.pct65)}`);
      for (const b of t.bars) {
        const v = sh.missing ? null : (b.sex < 0 ? sh.m[b.g] : sh.f[b.g]);
        b.el.setAttribute("data-value", v == null ? "" : String(v));
        to[k++] = widthOf(v);
      }
    }
    for (let s = 0; s < 2; s++) {
      const arr = s === 0 ? nat.m : nat.f;
      for (let g = 0; g < GROUPS; g++) natTo[s][g] = widthOf(arr[g]);
    }

    cancelAnimationFrame(raf);
    raf = 0;
    if (!animate || store.getState().reducedMotion) {
      cur.set(to);
      for (let s = 0; s < 2; s++) natCur[s].set(natTo[s]);
      for (const b of flatBars) b.last = undefined;
      paintAll();
      return;
    }
    from.set(cur);
    for (let s = 0; s < 2; s++) natFrom[s].set(natCur[s]);
    startTime = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const tileById = (id) => tiles.find((t) => t.id === id);
  return { build, show, tileById };
}
