// 断面の年の2Dピラミッド（SVG）。色と書式は全国ページと同じ。
import { COLORS } from "../config.js";
import { ageHeading, formatPersons } from "../format.js";

const NS = "http://www.w3.org/2000/svg";
const el = (name, attrs = {}, text) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
};

export function createInset({ root, data }) {
  const W = 320, ROW = 2.4, TOP = 34, BOTTOM = 22, H = TOP + ROW * 101 + BOTTOM;
  const CX = W / 2, HALF = 134, GAP = 0;
  const xMax = data.xMaxPerSex;
  const scale = (v) => Math.min(v, xMax) / xMax * HALF;

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", class: "inset-svg" });
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  root.replaceChildren(svg);

  function render(year) {
    const y = data.byYear.get(year);
    svg.replaceChildren();
    if (!y) return;
    svg.setAttribute("aria-label", `${year}年の人口ピラミッド（左が男性、右が女性）`);
    svg.append(el("text", { x: CX, y: 14, "text-anchor": "middle", class: "inset-year" }, `${year}年${y.kazoe ? "（数え年）" : ""}`));
    svg.append(el("text", { x: CX - 4, y: 28, "text-anchor": "end", class: "inset-head sex-male" }, "男性"));
    svg.append(el("text", { x: CX + 4, y: 28, "text-anchor": "start", class: "inset-head sex-female" }, "女性"));
    // 目盛り（50万人ごと）
    for (let v = 500000; v <= xMax; v += 500000) {
      for (const sgn of [-1, 1]) {
        const x = CX + sgn * (GAP + scale(v));
        svg.append(el("line", { x1: x, x2: x, y1: TOP, y2: TOP + ROW * 101, class: "grid-line" }));
      }
    }
    svg.append(el("line", { x1: CX, x2: CX, y1: TOP, y2: TOP + ROW * 101, class: "baseline" }));
    for (const age of [0, 20, 40, 60, 80, 100]) {
      const yy = TOP + ROW * (100 - age) + ROW / 2;
      svg.append(el("text", { x: CX, y: yy + 3, "text-anchor": "middle", class: "inset-age" }, String(age)));
    }
    const bars = el("g", { class: "inset-bars" });
    for (const sex of ["male", "female"]) {
      const arr = y[sex];
      for (let age = 0; age <= data.ageMax; age++) {
        const v = arr[age];
        if (v == null) continue;
        const w = scale(v);
        const x = sex === "male" ? CX - w : CX;
        const rect = el("rect", {
          x, y: TOP + ROW * (100 - age), width: w, height: ROW - 0.3,
          fill: sex === "male" ? COLORS.male : COLORS.female,
          class: "inset-bar" + (age === y.openAge ? " inset-open" : ""),
          "data-sex": sex, "data-age": age, "data-value": v,
        });
        const title = el("title", {}, `${ageHeading(y, age)}・${sex === "male" ? "男性" : "女性"} ${formatPersons(v, y.precision)}`);
        rect.append(title);
        bars.append(rect);
      }
    }
    svg.append(bars);
    svg.append(el("text", { x: CX - HALF, y: H - 6, class: "inset-axis" }, `${xMax / 10000}万人`));
    svg.append(el("text", { x: CX + HALF, y: H - 6, "text-anchor": "end", class: "inset-axis" }, `${xMax / 10000}万人`));
    svg.append(el("text", { x: CX, y: H - 6, "text-anchor": "middle", class: "inset-axis" }, "0"));
  }

  return { render };
}
