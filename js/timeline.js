import { MAX_WIDTH, NARROW_BREAKPOINT } from "./config.js";
import { ariaValueText } from "./format.js";

const PAD = 16; // 目盛り端の余白（スライダーは左右8px内側に置く＝つまみ幅16pxの半分を足して16）

export function createTimeline({ root, svgEl, slider, data, store }) {
  const d3 = window.d3;
  const svg = d3.select(svgEl);
  const { yearMin, yearMax, gaps } = data;
  let width = 0;
  let progress = null;
  let sx = () => 0;

  function draw() {
    width = root.clientWidth;
    const narrow = width < NARROW_BREAKPOINT;
    sx = d3.scaleLinear().domain([yearMin, yearMax]).range([PAD, width - PAD]);
    const unit = (width - 2 * PAD) / (yearMax - yearMin);
    svg.attr("width", width).attr("height", 62);
    svg.selectAll("*").remove();
    const defs = svg.append("defs");
    defs.append("pattern").attr("id", "gap-hatch").attr("width", 5).attr("height", 5)
      .attr("patternUnits", "userSpaceOnUse").attr("patternTransform", "rotate(45)")
      .append("line").attr("x1", 0).attr("x2", 0).attr("y1", 0).attr("y2", 5)
      .attr("class", "hatch-line");

    svg.append("line").attr("class", "tl-rail").attr("x1", sx(yearMin)).attr("x2", sx(yearMax)).attr("y1", 14).attr("y2", 14);
    progress = svg.append("line").attr("class", "tl-progress").attr("y1", 14).attr("y2", 14).attr("x1", sx(yearMin));

    const inGap = (y) => gaps.some((g) => y >= g.start && y <= g.end);
    const labelEvery = narrow ? 20 : 5;
    for (let y = yearMin; y <= yearMax; y++) {
      if (inGap(y)) continue;
      const major = y % 5 === 0;
      svg.append("line").attr("class", major ? "tl-tick tl-tick-major" : "tl-tick")
        .attr("x1", sx(y)).attr("x2", sx(y)).attr("y1", major ? 6 : 10).attr("y2", major ? 22 : 18);
      if ((y - yearMin) % labelEvery === 0 || (!narrow && y === yearMax)) {
        svg.append("text").attr("class", "tl-label").attr("x", sx(y)).attr("y", 40)
          .attr("text-anchor", "middle").text(y);
      }
    }
    for (const g of gaps) {
      const x0 = sx(g.start) - unit / 2, x1 = sx(g.end) + unit / 2;
      svg.append("rect").attr("class", "tl-gap").attr("x", x0).attr("y", 6).attr("width", x1 - x0).attr("height", 16)
        .attr("fill", "url(#gap-hatch)");
      svg.append("text").attr("class", "tl-gap-label").attr("x", (x0 + x1) / 2).attr("y", 56)
        .attr("text-anchor", "middle").text(data.notes[g.noteId]?.short || "推計なし");
    }
    sync();
  }

  function sync() {
    const state = store.getState();
    const y = data.byYear.get(state.year);
    slider.value = state.year;
    slider.setAttribute("aria-valuetext", ariaValueText(y));
    progress?.attr("x2", sx(state.year));
  }

  slider.min = yearMin;
  slider.max = yearMax;
  slider.step = 1;
  let lastRaw = store.getState().year; // 直前のスライダー生値（gap解決前）
  let inInput = false;
  // キー操作は現在値（解決後）からの±1なので、基準も現在値に合わせる
  slider.addEventListener("keydown", () => { lastRaw = store.getState().year; });
  slider.addEventListener("input", () => {
    store.pause();
    const v = Number(slider.value);
    const direction = v >= lastRaw ? 1 : -1;
    lastRaw = v;
    inInput = true;
    store.setYear(v, { direction });
    inInput = false;
    sync();
  });
  store.subscribe((s, change) => {
    if (change.type !== "year") return;
    if (!inInput) lastRaw = s.year; // 再生・URL・ボタンなど外部からの変更に追従
    sync();
  });

  draw();
  new ResizeObserver(() => { if (root.clientWidth !== width) draw(); }).observe(root);
  return { sync };
}
