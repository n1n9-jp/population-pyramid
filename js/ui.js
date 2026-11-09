import {
  wareki, yearMetaText, formatTotal, formatPersons, ageHeading, birthText, nullReason, ageLabel,
} from "./format.js";

const $ = (id) => document.getElementById(id);

export function createReadout({ data, store }) {
  const yearEl = $("year-display");
  const warekiEl = $("wareki-display");
  const metaEl = $("year-meta");
  const totalEl = $("total-display");
  const badgesEl = $("badges");
  const listEl = $("notes-list");
  const gapNotes = data.gaps.map((g) => g.noteId);

  function render() {
    const y = data.byYear.get(store.getState().year);
    yearEl.textContent = `${y.year}年`;
    warekiEl.textContent = wareki(y.refDate);
    metaEl.textContent = yearMetaText(y, data.basisLabels);
    totalEl.replaceChildren();
    const both = document.createElement("span");
    both.className = "total-both";
    both.textContent = formatTotal(y.total.both);
    const sexes = document.createElement("span");
    sexes.className = "total-sexes";
    sexes.textContent = `男性 ${formatTotal(y.total.male)}・女性 ${formatTotal(y.total.female)}`;
    totalEl.append(both, sexes);

    badgesEl.replaceChildren();
    listEl.replaceChildren();
    for (const id of y.noteIds) {
      const n = data.notes[id];
      if (n.kind === "badge") {
        const b = document.createElement("span");
        b.className = "badge";
        b.setAttribute("data-note", id);
        b.title = n.text;
        b.textContent = n.short;
        badgesEl.append(b);
      }
    }
    for (const id of [...y.noteIds, ...gapNotes]) {
      const li = document.createElement("li");
      li.setAttribute("data-note", id);
      li.textContent = data.notes[id].text;
      listEl.append(li);
    }
    document.body.dataset.year = String(y.year);
  }
  store.subscribe((_s, c) => { if (c.type === "year") render(); });
  render();
}

export function createDataTable({ data, store }) {
  const table = $("data-table");
  const tbody = document.createElement("tbody");
  const rows = [];
  for (let a = 0; a <= 100; a++) {
    const tr = document.createElement("tr");
    tr.innerHTML = "<th scope=row></th><td></td><td></td><td></td>";
    tbody.append(tr);
    rows.push(Array.from(tr.children));
  }
  table.append(tbody);
  const fmt = (v) => (v == null ? "—" : v.toLocaleString("en-US"));
  function render() {
    const y = data.byYear.get(store.getState().year);
    for (let a = 0; a <= 100; a++) {
      const m = y.male[a], f = y.female[a];
      const [th, tm, tf, tt] = rows[a];
      th.textContent = ageLabel(y, a);
      tm.textContent = fmt(m);
      tf.textContent = fmt(f);
      tt.textContent = m == null || f == null ? "—" : fmt(m + f);
    }
    $("data-table-caption").textContent = `${y.year}年の年齢（各歳）・男女別人口（人）`;
  }
  // 閉じている間は更新しない（再生中の無駄な描画を避ける）
  const details = $("data-details");
  store.subscribe((_s, c) => { if (c.type === "year" && details.open) render(); });
  details.addEventListener("toggle", () => { if (details.open) render(); });
  render();
}

export function createTooltip({ data, store, chart, wrap }) {
  const tip = $("tooltip");
  let shownAge = null;

  function content(y, age) {
    const frag = document.createDocumentFragment();
    const h = document.createElement("strong");
    h.className = "tip-head";
    h.textContent = ageHeading(y, age);
    frag.append(h);
    if (y.male[age] == null) {
      const p = document.createElement("div");
      p.className = "tip-null";
      p.textContent = nullReason(y, age);
      frag.append(p);
      return frag;
    }
    const b = document.createElement("div");
    b.className = "tip-birth";
    b.textContent = birthText(y, age);
    frag.append(b);
    for (const [cls, label, v] of [["male", "男性", y.male[age]], ["female", "女性", y.female[age]]]) {
      const row = document.createElement("div");
      row.className = `tip-row tip-${cls}`;
      const sw = document.createElement("i");
      sw.className = "swatch";
      const l = document.createElement("span");
      l.textContent = label;
      const n = document.createElement("span");
      n.className = "tip-num";
      n.textContent = formatPersons(v, y.precision);
      row.append(sw, l, n);
      frag.append(row);
    }
    return frag;
  }

  function show(age, e) {
    const y = data.byYear.get(store.getState().year);
    shownAge = age;
    store.setFocusAge(age);
    tip.replaceChildren(content(y, age));
    tip.hidden = false;
    const r = wrap.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = px + 14;
    if (x + w > r.width) x = px - w - 14;
    x = Math.max(0, Math.min(r.width - w, x));
    let ty = py - h - 12;
    if (ty < 0) ty = py + 18;
    tip.style.left = `${x}px`;
    tip.style.top = `${ty}px`;
  }

  function hide() {
    shownAge = null;
    tip.hidden = true;
    store.setFocusAge(null);
  }

  chart.hover.onRow = (age, e) => {
    if (age == null) return hide();
    if (e.type === "pointerdown" && e.pointerType === "touch" && shownAge === age) return hide();
    show(age, e);
  };
  document.addEventListener("pointerdown", (e) => {
    if (!wrap.contains(e.target)) hide();
  });
  store.subscribe((_s, c) => {
    if (c.type === "playing" && store.getState().playing) hide();
    if (c.type === "year" && shownAge != null) {
      const y = data.byYear.get(store.getState().year);
      tip.replaceChildren(content(y, shownAge));
    }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
}

export function createControls({ store }) {
  const play = $("btn-play");
  const rewind = $("btn-rewind");
  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  function render() {
    const p = store.getState().playing;
    play.setAttribute("aria-label", p ? "一時停止" : "再生");
    play.innerHTML = p ? ICON_PAUSE : ICON_PLAY;
  }
  play.addEventListener("click", () => (store.getState().playing ? store.pause() : store.play()));
  rewind.addEventListener("click", () => {
    store.pause();
    store.setYear(1920, { direction: 1 });
  });
  store.subscribe((_s, c) => { if (c.type === "playing") render(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) store.pause(); });
  render();
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
