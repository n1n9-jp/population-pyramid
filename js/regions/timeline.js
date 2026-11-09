import { NARROW_BREAKPOINT } from "./config.js";
import { ariaValueText } from "../format.js";

const PAD = 16; // 全国ページと同じ：つまみ幅16pxの半分を足した目盛り端の余白

/** 22時点を等間隔に並べたタイムライン（gap なし）。スライダーの値は年の添字0〜21。 */
export function createTimeline({ root, svgEl, slider, data, store }) {
  const d3 = window.d3;
  const svg = d3.select(svgEl);
  const last = data.years.length - 1;
  let width = 0;
  let progress = null;
  let sx = () => 0;

  function draw() {
    width = root.clientWidth;
    const narrow = width < NARROW_BREAKPOINT;
    sx = d3.scaleLinear().domain([0, last]).range([PAD, width - PAD]);
    svg.attr("width", width).attr("height", 44);
    svg.selectAll("*").remove();
    svg.append("line").attr("class", "tl-rail").attr("x1", sx(0)).attr("x2", sx(last)).attr("y1", 14).attr("y2", 14);
    progress = svg.append("line").attr("class", "tl-progress").attr("y1", 14).attr("y2", 14).attr("x1", sx(0));
    const every = width < 520 ? 4 : width < 900 ? 2 : 1;
    data.years.forEach((year, i) => {
      svg.append("line").attr("class", "tl-tick tl-tick-major").attr("x1", sx(i)).attr("x2", sx(i)).attr("y1", 7).attr("y2", 21);
      if (i % every === 0 || (every <= 2 && i === last)) {
        svg.append("text").attr("class", "tl-label").attr("x", sx(i)).attr("y", 38).attr("text-anchor", "middle").text(year);
      }
    });
    sync();
  }

  function sync() {
    const s = store.getState();
    slider.value = s.yearIndex;
    slider.setAttribute("aria-valuetext", ariaValueText(data.yearInfo[s.yearIndex]));
    progress?.attr("x2", sx(s.yearIndex));
  }

  slider.min = 0;
  slider.max = last;
  slider.step = 1;
  slider.addEventListener("input", () => {
    store.pause();
    store.setIndex(Number(slider.value));
  });
  store.subscribe((_s, c) => { if (c.type === "year") sync(); });

  draw();
  new ResizeObserver(() => { if (root.clientWidth !== width) draw(); }).observe(root);
  return { sync };
}
