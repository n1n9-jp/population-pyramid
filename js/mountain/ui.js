// free の UI（形・断面・世代）、ツールチップ、データ表、出典欄。
import { ageHeading, ageLabel, formatPersons, formatTotal, wareki } from "../format.js";
import { ALL_COHORTS } from "./tour.js";

const $ = (id) => document.getElementById(id);
const comma = (v) => Math.round(v).toLocaleString("en-US");

export function createFreeUI({ data, scene, inset, getStep }) {
  const slider = $("cut-slider");
  const out = $("cut-year-out");
  const note = $("cut-note");
  const toggle = $("form-toggle");
  const cohortBox = $("cohort-select");
  const { yearMin, yearMax, gaps } = data;
  let tour = null;
  let year = yearMax;
  let lastRaw = yearMax;

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
    const row = data.byYear.get(y);
    out.textContent = `${y}年（${wareki(row.refDate)}）`;
    slider.setAttribute("aria-valuetext", `${y}年${row.kazoe ? "（数え年）" : ""}`);
    note.textContent = message || (row.kazoe ? "この年の年齢は数え年です。" : "");
    inset.render(y);
    renderTable(data, y);
    renderYearNotes(data, y);
  }

  function setCutFromUser(y, dir) {
    const r = resolve(y, dir);
    const g = gapOf(y);
    showYear(r, g ? `${g.start}〜${g.end}年は推計がないため、${r}年を表示しています。` : "");
    if (getStep() === "free") scene.setCutYear(r);
  }

  slider.addEventListener("input", () => {
    const v = Number(slider.value);
    const dir = v >= lastRaw ? 1 : -1;
    lastRaw = v; // ドラッグ中は生の値を持つ（全国ページの timeline.js と同じ）
    setCutFromUser(v, dir);
  });
  // キー操作は現在値（解決後）からの±1なので、基準も現在値に合わせる
  slider.addEventListener("keydown", () => { lastRaw = year; });

  toggle.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-form]");
    if (b && tour) tour.setForm(b.dataset.form);
  });

  const selected = () => [...cohortBox.querySelectorAll("input[data-cohort]")].filter((i) => i.checked).map((i) => i.dataset.cohort);
  cohortBox.addEventListener("change", () => { if (getStep() === "free") scene.setHighlight(selected()); });

  $("data-details").addEventListener("toggle", () => renderTable(data, year));
  showYear(year);
  return {
    attach(t) { tour = t; },
    getCut: () => year,
    getHighlight: () => selected(),
    onForm(f) {
      toggle.querySelectorAll("button[data-form]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.form === f)));
    },
    // ツアー側が断面を変えたとき（cut2025 段）にスライダーを合わせる
    onCut(c) { if (c != null && c !== year) { lastRaw = c; showYear(c); } },
  };
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
  canvas.addEventListener("pointerleave", () => { tip.hidden = true; });

  scene.onPick((p) => {
    if (!p) { tip.hidden = true; return; }
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
