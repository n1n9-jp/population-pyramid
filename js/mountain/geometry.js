// 3Dページ「人口の山脈」のデータ整理と座標変換、ジオメトリの頂点配列づくり。
// three.js には依存しない（配列だけを返す）。各頂点は 2 つの形の座標を持つ：
//   A = 地形型（terrain）  x＝年、z＝年齢（男性は手前・女性は奥、100歳側で鏡写し）、y＝人数
//   B = 立体ピラミッド型（pyramid） y＝年齢、x＝人数（男性は −、女性は ＋）、z＝年（新しい年ほど手前）
// 変形は A→B の線形補間で行う（docs/MOUNTAIN.md §2）。

export const SEXES = ['male', 'female'];
export const SIGN = { male: -1, female: 1 };        // ピラミッド型の x の向き
export const COLORS = {
  male: '#9db9d9', female: '#ffc56e',
  maleStrong: '#3e6593', femaleStrong: '#8a5a12',
  maleThin: '#34567f', femaleThin: '#8a5a12',
};

/** 空間の寸法（ワールド単位） */
export const DIM = {
  span: 21,          // 年の軸の長さ（1920→2025 で 21）
  ageStep: 0.1,      // 年齢 1 歳あたり
  terrainH: 6.5,     // 地形型で xMaxPerSex の高さ
  pyramidW: 6.0,     // ピラミッド型で xMaxPerSex の横幅（片側）
  threadLiftT: 0.07, // 糸を面から浮かせる量（地形型・上へ）
  threadLiftP: 0.05, // 同（ピラミッド型・外へ）
};

/** data/pyramid.json を、描画で使う形に整理する */
export function makeModel(data) {
  const years = data.years.map(y => y);
  const yMin = years[0].year, yMax = years[years.length - 1].year;
  const ageMax = data.ageMax ?? 100;
  const vmax = data.xMaxPerSex;
  const index = new Map(years.map((y, i) => [y.year, i]));
  // i と i+1 が連続した年か（1940→1944 のすき間は false）
  const consecutive = i => i >= 0 && i + 1 < years.length && years[i + 1].year - years[i].year === 1;
  /** その年（index）・性・年齢の値。openAge の段・欠測は null */
  const val = (i, sex, a) => {
    const o = years[i]; if (!o || a < 0 || a > ageMax || a >= o.openAge) return null;
    const v = o[sex][a]; return v == null ? null : v;
  };
  const kazoe = i => !!years[i].kazoe;
  /** 生まれ年 b の人が、年 i に何歳の段にいるか（数え年は +1） */
  const ageOf = (i, b) => years[i].year - b + (kazoe(i) ? 1 : 0);
  const birthOf = (i, a) => years[i].year - a + (kazoe(i) ? 1 : 0);

  const TX = yr => ((yr - yMin) / (yMax - yMin) - 0.5) * DIM.span;
  const PZ = TX;
  const TZ = (sex, a) => (sex === 'male' ? 1 : -1) * (ageMax - a) * DIM.ageStep;
  const PY = a => a * DIM.ageStep;
  const TH = v => v / vmax * DIM.terrainH;
  const PX = v => v / vmax * DIM.pyramidW;

  return { data, years, yMin, yMax, ageMax, vmax, index, consecutive, val, kazoe, ageOf, birthOf, TX, PZ, TZ, PY, TH, PX };
}

/* ---------------------------------------------------------------- 色 */
// three.js の色管理に合わせ、sRGB の16進表記をリニアの rgb にする
const toLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [toLinear(((n >> 16) & 255) / 255), toLinear(((n >> 8) & 255) / 255), toLinear((n & 255) / 255)];
}
export const mixRgb = (c, to, t) => [c[0] + (to[0] - c[0]) * t, c[1] + (to[1] - c[1]) * t, c[2] + (to[2] - c[2]) * t];
const WHITE = [1, 1, 1], BLACK = [0, 0, 0];
export function baseColor(M, sex, i) {
  let c = hexToRgb(COLORS[sex]);
  if (M.kazoe(i)) c = mixRgb(c, WHITE, 0.55);   // 数え年の年は淡く
  return c;
}

/* ---------------------------------------------------------------- 面（男女それぞれ、index 付き） */
/**
 * 返り値：{ posA, posB, color, year, index, meta }
 *   meta は頂点ごとに [yearIndex, age] を並べた Int16Array（ピッキング用）
 */
export function buildSurface(M, sex) {
  const s = SIGN[sex];
  const posA = [], posB = [], color = [], year = [], meta = [], idx = [];
  const vid = new Map();
  const id = (i, a) => {
    const k = i * 128 + a; if (vid.has(k)) return vid.get(k);
    const v = M.val(i, sex, a); if (v == null) { vid.set(k, -1); return -1; }
    const yr = M.years[i].year;
    posA.push(M.TX(yr), M.TH(v), M.TZ(sex, a));
    posB.push(s * M.PX(v), M.PY(a + 0.5), M.PZ(yr));
    color.push(...baseColor(M, sex, i));
    year.push(yr); meta.push(i, a);
    const n = year.length - 1; vid.set(k, n); return n;
  };
  for (let i = 0; i + 1 < M.years.length; i++) {
    if (!M.consecutive(i)) continue;          // 1940→1944 は補間せず、すき間にする
    for (let a = 0; a < M.ageMax; a++) {
      const A = id(i, a), B = id(i + 1, a), C = id(i + 1, a + 1), D = id(i, a + 1);
      if (A < 0 || B < 0 || C < 0 || D < 0) continue;
      idx.push(A, B, C, A, C, D);
    }
  }
  return {
    posA: new Float32Array(posA), posB: new Float32Array(posB), color: new Float32Array(color),
    year: new Float32Array(year), index: idx, meta: new Int16Array(meta),
  };
}

/* ---------------------------------------------------------------- 側面（年の端・年齢の端の壁） */
// 地形型では床から面までの壁、ピラミッド型では軸（x=0）から輪郭までの板になる。
export function buildWalls(M, sex) {
  const s = SIGN[sex];
  const posA = [], posB = [], color = [], year = [];
  const S = (i, a) => { const v = M.val(i, sex, a), yr = M.years[i].year; return [[M.TX(yr), M.TH(v), M.TZ(sex, a)], [s * M.PX(v), M.PY(a + 0.5), M.PZ(yr)], yr]; };
  const F = (i, a) => { const yr = M.years[i].year; return [[M.TX(yr), 0, M.TZ(sex, a)], [0, M.PY(a + 0.5), M.PZ(yr)], yr]; };
  const quad = (p0, p1, p2, p3, c) => {
    for (const p of [p0, p1, p2, p0, p2, p3]) { posA.push(...p[0]); posB.push(...p[1]); color.push(...c); year.push(p[2]); }
  };
  const wcol = i => mixRgb(baseColor(M, sex, i), BLACK, 0.16);
  const ends = new Set();
  M.years.forEach((_, i) => {
    if (i === 0 || !M.consecutive(i - 1)) ends.add(i);
    if (i === M.years.length - 1 || !M.consecutive(i)) ends.add(i);
  });
  for (const i of ends) {
    for (let a = 0; a < M.ageMax; a++) {
      if (M.val(i, sex, a) == null || M.val(i, sex, a + 1) == null) continue;
      quad(F(i, a), S(i, a), S(i, a + 1), F(i, a + 1), wcol(i));
    }
  }
  for (let i = 0; i + 1 < M.years.length; i++) {
    if (!M.consecutive(i)) continue;
    let lo = -1, hi = -1;
    for (let a = 0; a <= M.ageMax; a++) if (M.val(i, sex, a) != null && M.val(i + 1, sex, a) != null) { if (lo < 0) lo = a; hi = a; }
    if (lo < 0) continue;
    for (const a of (lo === hi ? [lo] : [lo, hi])) quad(F(i, a), F(i + 1, a), S(i + 1, a), S(i, a), wcol(i));
  }
  return { posA: new Float32Array(posA), posB: new Float32Array(posB), color: new Float32Array(color), year: new Float32Array(year) };
}

/* ---------------------------------------------------------------- 面の上の補助線（10年ごと・10歳ごと） */
export function buildSurfaceGrid(M, sex) {
  const s = SIGN[sex], lift = 0.012;
  const posA = [], posB = [];
  const P = (i, a) => {
    const v = M.val(i, sex, a); if (v == null) return null; const yr = M.years[i].year;
    return [[M.TX(yr), M.TH(v) + lift, M.TZ(sex, a)], [s * (M.PX(v) + lift), M.PY(a + 0.5), M.PZ(yr)]];
  };
  const seg = (p, q) => { posA.push(...p[0], ...q[0]); posB.push(...p[1], ...q[1]); };
  M.years.forEach((y, i) => {
    if (y.year % 10 !== 0) return;
    for (let a = 0; a < M.ageMax; a++) { const p = P(i, a), q = P(i, a + 1); if (p && q) seg(p, q); }
  });
  for (let a = 10; a < M.ageMax; a += 10) {
    for (let i = 0; i + 1 < M.years.length; i++) {
      if (!M.consecutive(i)) continue;
      const p = P(i, a), q = P(i + 1, a); if (p && q) seg(p, q);
    }
  }
  return { posA: new Float32Array(posA), posB: new Float32Array(posB) };
}

/* ---------------------------------------------------------------- openAge の印 */
// 面の上端の外（openAge の段の位置）に小さな点を置く。値は面に含めない。
export function buildOpenMarks(M) {
  const posA = [], posB = [], meta = [];
  M.years.forEach((y, i) => {
    for (const sex of SEXES) {
      const v = y[sex][y.openAge]; if (v == null) continue;
      const a = y.openAge;
      posA.push(M.TX(y.year), 0.06, M.TZ(sex, a + 0.6));
      posB.push(SIGN[sex] * 0.12, M.PY(a + 0.6), M.PZ(y.year));
      meta.push({ yearIndex: i, sex, age: a, value: v });
    }
  });
  return { posA: new Float32Array(posA), posB: new Float32Array(posB), meta };
}

/* ---------------------------------------------------------------- 断面（cut）の板と輪郭 */
// 段ごとの長方形（2Dピラミッドと同じ階段形）。eps だけ未来側にずらし、壁との重なりを避ける。
export function buildCutSlab(M, i, sex, highlightBirths, eps = 0.02) {
  const s = SIGN[sex], yr = M.years[i].year;
  const xA = M.TX(yr) + eps, zB = M.PZ(yr) + eps;
  const posA = [], posB = [], color = [], outA = [], outB = [];
  const base = mixRgb(hexToRgb(COLORS[sex]), BLACK, 0.08);
  const strong = hexToRgb(sex === 'male' ? COLORS.maleStrong : COLORS.femaleStrong);
  const rows = [];
  for (let a = 0; a < M.ageMax; a++) { const v = M.val(i, sex, a); if (v != null) rows.push([a, v]); }
  for (const [a, v] of rows) {
    const c = highlightBirths.has(M.birthOf(i, a)) ? strong : base;
    const A = [[xA, 0, M.TZ(sex, a)], [xA, M.TH(v), M.TZ(sex, a)], [xA, M.TH(v), M.TZ(sex, a + 1)], [xA, 0, M.TZ(sex, a + 1)]];
    const B = [[0, M.PY(a), zB], [s * M.PX(v), M.PY(a), zB], [s * M.PX(v), M.PY(a + 1), zB], [0, M.PY(a + 1), zB]];
    for (const k of [0, 1, 2, 0, 2, 3]) { posA.push(...A[k]); posB.push(...B[k]); color.push(...c); }
  }
  // 輪郭（階段形の折れ線）。始点と終点は軸の上。
  if (rows.length) {
    const e2 = eps * 2, xo = M.TX(yr) + e2, zo = M.PZ(yr) + e2;
    const lo = rows[0][0], hi = rows[rows.length - 1][0];
    outA.push(xo, 0, M.TZ(sex, lo)); outB.push(0, M.PY(lo), zo);
    for (const [a, v] of rows) {
      outA.push(xo, M.TH(v), M.TZ(sex, a), xo, M.TH(v), M.TZ(sex, a + 1));
      outB.push(s * M.PX(v), M.PY(a), zo, s * M.PX(v), M.PY(a + 1), zo);
    }
    outA.push(xo, 0, M.TZ(sex, hi + 1)); outB.push(0, M.PY(hi + 1), zo);
  }
  return { posA, posB, color, outA, outB };
}

/** 折れ線（点列）を線分の組に直す */
export function polylineToSegments(pts) {
  const out = [];
  for (let k = 0; k + 5 < pts.length; k += 3) out.push(pts[k], pts[k + 1], pts[k + 2], pts[k + 3], pts[k + 4], pts[k + 5]);
  return out;
}

/** 2 つの配列を t で補間して out に書く */
export function lerpInto(out, a, b, t) {
  if (t <= 0) { out.set(a); return; }
  if (t >= 1) { out.set(b); return; }
  for (let k = 0; k < out.length; k++) out[k] = a[k] + (b[k] - a[k]) * t;
}
