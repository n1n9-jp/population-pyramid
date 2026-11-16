// 尾根沿いのフライト（docs/MOUNTAIN.md §4 の fly）の経路づくり。three.js には依存しない。
// 世代の糸（男性の面）に沿って、糸から横に少し離れ、近くの面より少し高い位置を飛ぶ。
// 視線は経路の少し先の糸の点に向ける。経路・高さ・視線はどれも移動平均でなめらかにする。
import { DIM } from './geometry.js';

export const FLIGHT = {
  fov: 58,          // 飛行中の画角（度）
  lateral: 0.85,    // 糸から横（若い年齢の側）へ離す量（ワールド単位。0.1 で 1 歳）
  ridgeLift: 0.3,   // 尾根（糸）の高さより上に保つ量
  clear: 0.32,      // 近くの面の高さの最大値より上に保つ量
  radius: 0.45,     // 「近くの面」とみなす半径
  leadYears: 10,    // 視線を向ける点：何年先の経路の点か
  lookPull: 0.6,    // 視線の点を、糸の側へ寄せる割合（lateral に対して）
  lookDrop: 0.55,   // 視線の点を経路より下げる量（尾根を少し見下ろす）
  perYear: 8,       // 1年あたりの標本数
  endYears: 9,      // 終わりに上がり始める年数
  endRise: 1.6,     // 終わりに上がる量
  endSide: 0.9,     // 終わりに横へ離れる量
  smoothYears: 2.5, // 高さ・位置の移動平均の幅（片側、年）
  lookSmoothYears: 4,
};

/** 面の高さ（地形型の y）。z の符号で男女を決める。面のない所は 0 */
export function surfaceHeight(M, x, z) {
  const sex = z >= 0 ? 'male' : 'female';
  const Y = M.yMin + (x / DIM.span + 0.5) * (M.yMax - M.yMin);
  const a = M.ageMax - Math.abs(z) / DIM.ageStep;
  if (!(Y >= M.yMin && Y <= M.yMax && a >= 0 && a <= M.ageMax)) return 0;
  const col = yr => {
    const i = M.index.get(yr); if (i === undefined) return null;
    const a0 = Math.floor(a), a1 = Math.min(M.ageMax, a0 + 1), ta = a - a0;
    const v0 = M.val(i, sex, a0), v1 = M.val(i, sex, a1);
    if (v0 == null && v1 == null) return 0;
    return M.TH((v0 ?? v1) * (1 - ta) + (v1 ?? v0) * ta);
  };
  const y0 = Math.floor(Y), ty = Y - y0;
  const h0 = col(y0), h1 = col(Math.min(M.yMax, y0 + 1));
  if (h0 == null && h1 == null) return 0;          // すき間の年（壁の高さは両隣の年で拾う）
  return (h0 ?? h1) * (1 - ty) + (h1 ?? h0) * ty;
}

/** (x, z) を中心とする半径 r の円の中の、面の高さの最大値 */
export function localMaxHeight(M, x, z, r = FLIGHT.radius, n = 6) {
  let h = 0;
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
    const dx = i / n * r, dz = j / n * r;
    if (dx * dx + dz * dz > r * r + 1e-9) continue;
    h = Math.max(h, surfaceHeight(M, x + dx, z + dz));
  }
  return h;
}

// 窓の幅を端で縮める移動平均（直線の経路が端で曲がらないように左右対称にする）
function movingAvg(arr, w) {
  const n = arr.length, out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const h = Math.min(w, k, n - 1 - k);
    let s = 0; for (let j = k - h; j <= k + h; j++) s += arr[j];
    out[k] = s / (2 * h + 1);
  }
  return out;
}
// 幅 w の平均（端では窓を切り詰める）
function boxBlur(arr, w) {
  const n = arr.length, out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0, c = 0; for (let j = Math.max(0, k - w); j <= Math.min(n - 1, k + w); j++) { s += arr[j]; c++; }
    out[k] = s / c;
  }
  return out;
}
// 幅 2w で膨張（最大値）→ 幅 w の平均を2回。平均の及ぶ範囲（2w）は膨張の範囲に収まるので、結果は元の値を下回らない
function dilateBlur(arr, w) {
  const n = arr.length, d = new Float64Array(n);
  for (let k = 0; k < n; k++) { let m = -Infinity; for (let j = Math.max(0, k - 2 * w); j <= Math.min(n - 1, k + 2 * w); j++) m = Math.max(m, arr[j]); d[k] = m; }
  return boxBlur(boxBlur(d, w), w);
}

/**
 * 生まれ年 birth の糸（男性の面）に沿う経路を作る。
 * 返り値：{ birth, y0, y1, poseAt(p), infoAt(p), box, fwd, right }
 *   poseAt(p) → { pos:[x,y,z], look:[x,y,z] }（p は 0〜1）
 *   infoAt(p) → { year, age, value, kazoe }（年は推計のある年に丸める）
 */
export function buildFlightPath(M, birth, opt = {}) {
  const F = { ...FLIGHT, ...opt };
  const years = M.years.map(r => r.year);
  const y0 = Math.max(birth, M.yMin), y1 = M.yMax;
  // 推計のある年の糸の点。1941〜43年のすき間は、両隣の年の点を結んで飛び越える
  const P = i => {
    const a = M.ageOf(i, birth), v = M.val(i, 'male', a);
    return [M.TX(years[i]), v == null ? 0 : M.TH(v) + DIM.threadLiftT, M.TZ('male', Math.max(0, a))];
  };
  const threadAt = Y => {
    let i1 = years.findIndex(y => y >= Y); if (i1 < 0) i1 = years.length - 1;
    const i0 = years[i1] === Y || i1 === 0 ? i1 : i1 - 1;
    const p0 = P(i0), p1 = P(i1), t = i1 === i0 ? 0 : (Y - years[i0]) / (years[i1] - years[i0]);
    return [0, 1, 2].map(k => p0[k] + (p1[k] - p0[k]) * t);
  };
  // 糸の進む向き（1年で x が進み、年齢が1つ上がる）と、その右（若い年齢の側）
  const dx = M.TX(1) - M.TX(0), dz = -DIM.ageStep, L = Math.hypot(dx, dz);
  const fwd = [dx / L, 0, dz / L], right = [-fwd[2], 0, fwd[0]];

  const N = Math.max(2, Math.ceil((y1 - y0) * F.perYear) + 1);
  const W = Math.round(F.smoothYears * F.perYear), WL = Math.round(F.lookSmoothYears * F.perYear);
  const T = [];
  for (let k = 0; k < N; k++) T.push(threadAt(y0 + (y1 - y0) * k / (N - 1)));
  // 位置（xz）：同じ年のまま、若い年齢の側（手前、+z）へ lateral 離す。年の向きにはずらさないので、
  // 2025年でちょうど面の端に着く。移動平均で数え年の年の段差をならす
  const side = [0, 0, 1];
  // 終わりの endYears 年は、少しずつ上がりながら横へ離れ、尾根の端を見下ろす
  const endN = Math.min(N - 1, Math.round(F.endYears * F.perYear));
  const endK = k => { const t = Math.max(0, (k - (N - 1 - endN)) / Math.max(1, endN)); return t * t * (3 - 2 * t); };
  const cx = movingAvg(movingAvg(T.map((p, k) => p[0] + side[0] * (F.lateral + F.endSide * endK(k))), W), W);
  const cz = movingAvg(movingAvg(T.map((p, k) => p[2] + side[2] * (F.lateral + F.endSide * endK(k))), W), W);
  // 高さ：尾根より ridgeLift 上、かつ近くの面の最大値より clear 上。膨張→平均でなめらかにしても下回らない
  const req = T.map((p, k) => Math.max(p[1] + F.ridgeLift, localMaxHeight(M, cx[k], cz[k], F.radius) + F.clear));
  const baseY = dilateBlur(req, W);
  const cy = baseY.map((h, k) => h + F.endRise * endK(k));
  // 視線：leadYears 先の経路の点を、糸の側へ lookPull だけ寄せ、lookDrop だけ下げた点。
  // 2025年より先には延ばさない（終わりに近づくと、視線は尾根の端へ向きを変える）
  const lead = Math.round(F.leadYears * F.perYear), pull = F.lateral * F.lookPull;
  const look = [[], [], []];
  for (let k = 0; k < N; k++) {
    const j = Math.min(N - 1, k + lead);
    // 終わりに上がる分・離れる分は視線に含めない（上がるほど尾根を見下ろす）
    look[0].push(T[j][0] + side[0] * (F.lateral - pull));
    look[1].push(baseY[j] - F.lookDrop);
    look[2].push(T[j][2] + side[2] * (F.lateral - pull));
  }
  const lx = movingAvg(movingAvg(look[0], WL), WL), ly = movingAvg(movingAvg(look[1], WL), WL), lz = movingAvg(movingAvg(look[2], WL), WL);

  const lerpArr = (a, u) => { const i = Math.min(N - 2, Math.floor(u)), t = u - i; return a[i] + (a[i + 1] - a[i]) * t; };
  const poseAt = p => {
    const u = Math.max(0, Math.min(1, p)) * (N - 1);
    return { pos: [lerpArr(cx, u), lerpArr(cy, u), lerpArr(cz, u)], look: [lerpArr(lx, u), lerpArr(ly, u), lerpArr(lz, u)] };
  };
  const infoAt = p => {
    const Y = y0 + (y1 - y0) * Math.max(0, Math.min(1, p));
    // 推計のある年のうち、いちばん近い年
    let i = 0, best = Infinity;
    years.forEach((y, k) => { const d = Math.abs(y - Y); if (d < best - 1e-9 && y >= y0) { best = d; i = k; } });
    const age = M.ageOf(i, birth);
    return { year: years[i], age, value: M.val(i, 'male', age), kazoe: M.kazoe(i) };
  };
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, hMax = 0;
  for (let k = 0; k < N; k++) {
    x0 = Math.min(x0, T[k][0]); x1 = Math.max(x1, T[k][0]);
    z0 = Math.min(z0, T[k][2]); z1 = Math.max(z1, T[k][2]); hMax = Math.max(hMax, T[k][1]);
  }
  return { birth, y0, y1, poseAt, infoAt, fwd, right, box: [[x0, x1], [0, hMax], [z0, z1]], samples: N };
}
