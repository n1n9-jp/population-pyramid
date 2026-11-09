import { COLORS, COHORTS, ANIM, NARROW_BREAKPOINT, MAX_WIDTH, AGE_MAX } from "./config.js";
import { formatTotal } from "./format.js";

const NB = AGE_MAX + 1;

export function createChart({ svg: svgEl, wrap, calloutHost, data, store }) {
  const d3 = window.d3;
  const svg = d3.select(svgEl);
  const xMax = data.xMaxPerSex;

  const layout = {
    width: 0, height: 0, halfWidth: 0, rowHeight: 0, ageWidth: 0, narrow: false,
    margin: { top: 30, right: 0, bottom: 44, left: 6 },
    xMale: 0, xFemale: 0,
  };

  // --- 静的な要素（一度だけ作る） ---
  svg.attr("role", "img");
  const gGrid = svg.append("g").attr("class", "grid");
  const gFocus = svg.append("g");
  const focusRect = gFocus.append("rect").attr("class", "row-focus").attr("hidden", "");
  const gBars = svg.append("g").attr("class", "bars");
  const bars = [];
  for (const sex of ["male", "female"]) {
    for (let a = 0; a <= AGE_MAX; a++) {
      const r = gBars.append("rect")
        .attr("class", "bar").attr("data-sex", sex).attr("data-age", a).attr("data-value", "")
        .attr("fill", sex === "male" ? COLORS.male : COLORS.female)
        .attr("width", 0);
      bars.push(r.node());
    }
  }
  const idx = (sex, age) => (sex === "male" ? 0 : NB) + age;

  const gCohorts = svg.append("g").attr("class", "cohorts");
  const cohortEls = COHORTS.map((c) => {
    const g = gCohorts.append("g").attr("class", "cohort").attr("data-cohort", c.id)
      .attr("data-age-min", "").attr("data-age-max", "").attr("hidden", "");
    g.append("path").attr("class", "cohort-bracket");
    g.append("text").attr("class", "cohort-text");
    return { c, g: g.node(), path: g.select("path").node(), text: g.select("text").node(), range: null, top: 0, bottom: 0 };
  });

  const leader = svg.append("line").attr("class", "leader").attr("hidden", "");
  const gHits = svg.append("g").attr("class", "hits");
  const hits = [];
  for (let a = 0; a <= AGE_MAX; a++) {
    hits.push(gHits.append("rect").attr("class", "row-hit").attr("data-age", a).node());
  }

  // --- アニメーション状態 ---
  let cur = new Float64Array(2 * NB);
  let target = new Float64Array(2 * NB);
  let raf = 0;
  let calloutEl = null;
  let calloutId = null;
  let calloutBox = { w: 0, h: 0 };

  const yTop = (age) => layout.margin.top + (AGE_MAX - age) * layout.rowHeight;
  const yCenter = (age) => yTop(age) + layout.rowHeight / 2;

  function currentYearData() {
    return data.byYear.get(store.getState().year);
  }

  // --- レイアウト ---
  function computeLayout() {
    const avail = Math.min(MAX_WIDTH, wrap.clientWidth || MAX_WIDTH);
    const narrow = avail < NARROW_BREAKPOINT;
    layout.narrow = narrow;
    layout.width = avail;
    layout.ageWidth = narrow ? 30 : 40;
    layout.margin.left = 14;
    layout.margin.right = narrow ? 46 : 100;
    layout.margin.top = 30;
    layout.margin.bottom = 46;
    layout.rowHeight = narrow ? 4.6 : 5.6;
    layout.halfWidth = (avail - layout.margin.left - layout.margin.right - layout.ageWidth) / 2;
    layout.xMale = layout.margin.left + layout.halfWidth;
    layout.xFemale = layout.xMale + layout.ageWidth;
    layout.height = layout.margin.top + NB * layout.rowHeight + layout.margin.bottom;
  }

  function drawStatic() {
    const { margin, halfWidth, ageWidth, rowHeight, narrow, xMale, xFemale } = layout;
    svg.attr("width", layout.width).attr("height", layout.height);
    gGrid.selectAll("*").remove();
    const y0 = margin.top;
    const y1 = margin.top + NB * rowHeight;
    const sx = d3.scaleLinear().domain([0, xMax]).range([0, halfWidth]);
    const tickStep = 500000;
    const ticks = d3.range(0, xMax + 1, tickStep);

    // 横グリッド＋年齢ラベル
    const step = narrow ? 10 : 5;
    for (let a = 0; a <= AGE_MAX; a += step) {
      const y = yCenter(a);
      for (const [x0, x1] of [[margin.left, xMale], [xFemale, xFemale + halfWidth]]) {
        gGrid.append("line").attr("class", "grid-line").attr("x1", x0).attr("x2", x1).attr("y1", y).attr("y2", y);
      }
      gGrid.append("text").attr("class", "age-label").attr("x", xMale + ageWidth / 2).attr("y", y)
        .attr("dy", "0.35em").attr("text-anchor", "middle").text(a);
    }
    // 縦グリッド＋軸ラベル
    for (const t of ticks) {
      const dx = sx(t);
      for (const [x, anchorBase] of [[xMale - dx, "male"], [xFemale + dx, "female"]]) {
        gGrid.append("line").attr("class", "grid-line").attr("x1", x).attr("x2", x).attr("y1", y0).attr("y2", y1);
        gGrid.append("text").attr("class", "axis-label").attr("x", x).attr("y", y1 + 15)
          .attr("text-anchor", "middle").attr("data-axis", anchorBase).text(t / 10000);
      }
    }
    gGrid.append("line").attr("class", "baseline").attr("x1", margin.left).attr("x2", xMale)
      .attr("y1", y1).attr("y2", y1);
    gGrid.append("line").attr("class", "baseline").attr("x1", xFemale).attr("x2", xFemale + halfWidth)
      .attr("y1", y1).attr("y2", y1);
    gGrid.append("text").attr("class", "axis-caption").attr("x", (xMale + xFemale) / 2).attr("y", y1 + 33)
      .attr("text-anchor", "middle").text("人口（万人）");
    // 男女の見出し
    gGrid.append("text").attr("class", "sex-head sex-male").attr("x", xMale).attr("y", y0 - 10)
      .attr("text-anchor", "end").text("男性");
    gGrid.append("text").attr("class", "sex-head sex-female").attr("x", xFemale).attr("y", y0 - 10)
      .attr("text-anchor", "start").text("女性");

    // 棒の位置・高さ
    const bh = Math.max(2, rowHeight - 1);
    for (let a = 0; a <= AGE_MAX; a++) {
      const y = yTop(a) + (rowHeight - bh) / 2;
      for (const sex of ["male", "female"]) {
        const el = bars[idx(sex, a)];
        el.setAttribute("y", y);
        el.setAttribute("height", bh);
      }
      const h = hits[a];
      h.setAttribute("x", 0); h.setAttribute("width", layout.width);
      h.setAttribute("y", yTop(a)); h.setAttribute("height", rowHeight);
    }
    focusRect.attr("x", 0).attr("width", layout.width).attr("height", rowHeight);
    updateFocus();

    // 凡例的な見出しの文字サイズに合わせたコホート文字
    for (const c of cohortEls) {
      c.text.textContent = narrow ? c.c.short : c.c.label;
    }
  }

  function widthFor(sex, age, y) {
    const v = (sex === "male" ? y.male : y.female)[age];
    return v == null ? 0 : (v / xMax) * layout.halfWidth;
  }

  function paintBars() {
    for (let a = 0; a <= AGE_MAX; a++) {
      const wm = Math.max(0, cur[idx("male", a)]);
      const m = bars[idx("male", a)];
      m.setAttribute("width", wm);
      m.setAttribute("x", layout.xMale - wm);
      const f = bars[idx("female", a)];
      f.setAttribute("width", Math.max(0, cur[idx("female", a)]));
      f.setAttribute("x", layout.xFemale);
    }
  }

  // --- コホート ---
  function cohortRange(c, y) {
    if (y.kazoe) return null;
    const lo = Math.max(y.minAge, y.year - c.birthEnd);
    const hi = Math.min(y.openAge - 1, y.year - c.birthStart);
    return lo <= hi ? [lo, hi] : null;
  }

  function targetCohorts(y) {
    for (const c of cohortEls) {
      const r = cohortRange(c.c, y);
      const wasShown = !c.g.hasAttribute("hidden");
      c.range = r;
      if (!r) {
        c.g.setAttribute("hidden", "");
        c.g.setAttribute("data-age-min", "");
        c.g.setAttribute("data-age-max", "");
        c.next = null;
        continue;
      }
      c.g.removeAttribute("hidden");
      c.g.setAttribute("data-age-min", r[0]);
      c.g.setAttribute("data-age-max", r[1]);
      c.next = { top: yTop(r[1]), bottom: yTop(r[0]) + layout.rowHeight };
      c.from = wasShown ? { top: c.top, bottom: c.bottom } : c.next;
    }
  }

  function paintCohort(c, t) {
    if (!c.next) return;
    const e = c.from;
    c.top = e.top + (c.next.top - e.top) * t;
    c.bottom = e.bottom + (c.next.bottom - e.bottom) * t;
    const x = layout.xFemale + layout.halfWidth + 6;
    const mid = (c.top + c.bottom) / 2;
    const k = 4;
    c.path.setAttribute("d", `M${x},${c.top + 0.5} h${k} V${c.bottom - 0.5} h${-k}`);
    c.text.setAttribute("x", x + k + 4);
    c.text.setAttribute("y", mid);
  }

  // --- 吹き出し ---
  function ensureCallout(y) {
    const noteId = y.noteIds.find((id) => data.notes[id]?.kind === "callout");
    if (!noteId) {
      calloutEl?.remove(); calloutEl = null; calloutId = null;
      return null;
    }
    const note = data.notes[noteId];
    if (calloutId !== noteId || !calloutEl) {
      calloutEl?.remove();
      calloutEl = document.createElement("div");
      calloutEl.className = "callout";
      calloutEl.setAttribute("data-note", noteId);
      calloutHost.appendChild(calloutEl);
      calloutId = noteId;
    }
    const wanted = layout.narrow ? note.short : note.text;
    if (calloutEl.textContent !== wanted) calloutEl.textContent = wanted;
    calloutEl.classList.toggle("callout-short", layout.narrow);
    return calloutEl;
  }

  function positionCallout(y) {
    if (!calloutEl) { leader.attr("hidden", ""); return; }
    const open = y.openAge;
    const barLeft = layout.xMale - cur[idx("male", open)];
    const cy = yCenter(open);
    if (layout.narrow) {
      leader.attr("hidden", "");
      calloutEl.style.left = `${barLeft - 4}px`;
      calloutEl.style.top = `${cy}px`;
      calloutEl.style.width = "";
      return;
    }
    const w = Math.min(230, layout.halfWidth * 0.6);
    const left = layout.margin.left + 6;
    const top = layout.margin.top + 2;
    calloutEl.style.left = `${left}px`;
    calloutEl.style.top = `${top}px`;
    calloutEl.style.width = `${w}px`;
    const h = calloutEl.offsetHeight;
    leader.attr("hidden", null).attr("x1", left + w).attr("y1", top + h / 2)
      .attr("x2", barLeft).attr("y2", cy);
  }

  // --- 年の更新 ---
  function ariaLabel(y) {
    return `${y.year}年の日本の人口ピラミッド。総人口${formatTotal(y.total.both)}、男性${formatTotal(y.total.male)}、女性${formatTotal(y.total.female)}。`;
  }

  function setYear(y, { animate, duration }) {
    cancelAnimationFrame(raf);
    raf = 0;
    svgEl.setAttribute("aria-label", ariaLabel(y));
    for (let a = 0; a <= AGE_MAX; a++) {
      for (const sex of ["male", "female"]) {
        const v = (sex === "male" ? y.male : y.female)[a];
        bars[idx(sex, a)].setAttribute("data-value", v == null ? "" : v);
        target[idx(sex, a)] = widthFor(sex, a, y);
      }
    }
    targetCohorts(y);
    ensureCallout(y);

    if (!animate || duration <= 0) {
      cur.set(target);
      paintBars();
      cohortEls.forEach((c) => { c.from = c.next; paintCohort(c, 1); });
      positionCallout(y);
      return;
    }
    const start = cur.slice();
    const t0 = performance.now();
    const ease = duration === ANIM.playBarMs ? d3.easeLinear : d3.easeCubicOut;
    const frame = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const e = ease(p);
      for (let i = 0; i < cur.length; i++) cur[i] = start[i] + (target[i] - start[i]) * e;
      paintBars();
      cohortEls.forEach((c) => paintCohort(c, e));
      positionCallout(y);
      raf = p < 1 ? requestAnimationFrame(frame) : 0;
      if (p >= 1) { cur.set(target); paintBars(); positionCallout(y); }
    };
    raf = requestAnimationFrame(frame);
  }

  function relayout() {
    computeLayout();
    drawStatic();
    const y = currentYearData();
    // 幅が変わったので目標値を再計算し、遷移なしで反映する
    setYear(y, { animate: false, duration: 0 });
  }

  // --- 行のフォーカス（ツールチップ用） ---
  function updateFocus() {
    const a = store.getState().focusAge;
    if (a == null) focusRect.attr("hidden", "");
    else focusRect.attr("hidden", null).attr("y", yTop(a));
  }

  const hover = { onRow: null };
  hits.forEach((h, a) => {
    h.addEventListener("pointerenter", (e) => hover.onRow?.(a, e));
    h.addEventListener("pointermove", (e) => hover.onRow?.(a, e));
    h.addEventListener("pointerdown", (e) => hover.onRow?.(a, e));
    h.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") hover.onRow?.(null, e); });
  });

  store.subscribe((state, change) => {
    if (change.type === "focus") updateFocus();
  });

  computeLayout();
  drawStatic();
  new ResizeObserver(() => {
    const w = Math.min(MAX_WIDTH, wrap.clientWidth || MAX_WIDTH);
    if (w !== layout.width) relayout();
  }).observe(wrap);

  return {
    layout,
    hover,
    showYear(year, { animate = true } = {}) {
      const st = store.getState();
      const duration = st.reducedMotion ? 0 : st.playing ? ANIM.playBarMs : ANIM.barMs;
      setYear(data.byYear.get(year), { animate, duration });
    },
    yCenter,
  };
}
