// 3Dページ「人口の山脈とコホートの糸」の描画部品（docs/MOUNTAIN.md §1〜§4）。
// createMountain({canvas, data, reducedMotion}) で作り、API はファイル末尾の return を参照。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import {
  SEXES, SIGN, COLORS, makeModel, hexToRgb, buildSurface, buildWalls, buildSurfaceGrid,
  buildOpenMarks, buildCutSlab, polylineToSegments, lerpInto,
} from './geometry.js';
import { COHORTS, COHORT_IDS, cohortOfBirth, baseBirthYears, buildThreads } from './cohorts.js';
import { LabelSet } from './labels.js';
import { FLIGHT, buildFlightPath, surfaceHeight, localMaxHeight } from './flight.js';

export const FORMS = ['terrain', 'pyramid'];
export const CAMERA_PRESETS = ['overview', 'war', 'dankai', 'hinoeuma', 'dankai-jr', 'cut2025', 'pyramid-front', 'free'];
export { COHORT_IDS };

const FORM_MS = 700, CAM_MS = 900;
const FLY_MS = 12000, FLY_BLEND_MS = 1400;   // フライトの既定の長さと、始めの視点からなじませる時間
const ORTHO_EQ_FOV = 6;            // 正射影へ切り替える直前の、ほぼ平行な透視投影の画角
const NO_CUT = 1e6;
const FRONT_DOT = [0.9, 0.97];   // ピラミッド型を正面に近い向きで見ているとみなす、視線と z 軸の内積の範囲
const clamp01 = v => Math.max(0, Math.min(1, v));
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* ---------------------------------------------------------------- カメラのプリセット */
// fitR：この半径の球が画面に収まる距離に置く（縦長の画面でも切れないように）。
// 正射影は view（縦の範囲）と fitW（横に必要な範囲）で決める。
// box：画面に収める範囲。'all' は内容の外形すべて（目盛りの文字も含む）。
// 範囲を指定したプリセットは、その範囲と、範囲の近くにある目盛りの文字が収まる距離に置く。
function presetTable(M) {
  const TX = M.TX, PZ = M.PZ, H = M.TH(M.vmax), zb = M.TZ('female', 0), zf = M.TZ('male', 0);
  const years = (y0, y1, z0 = zb, z1 = zf) => [[TX(y0), TX(y1)], [0, H], [z0, z1]];
  return {
    terrain: {
      overview: { target: [0, 1.2, 1.0], dir: [-0.26, 0.72, 0.64], fov: 33, box: 'all', margin: 0.94 },
      // 世代を追う段（onTop）：主役の糸は谷の底を通り、手前の尾根に隠れるので、面より手前に描く
      war: { target: [TX(1948), 1.0, 0], dir: [-0.6, 0.55, 0.58], fov: 33, box: years(1930, 1985), margin: 0.98, onTop: true },
      dankai: { target: [3.0, 1.2, 4.0], dir: [-0.42, 0.6, 0.68], fov: 33, box: years(1950, 2025, 0, zf), margin: 0.98, onTop: true },
      // 丙午の谷は年が進むほど年齢が上がる斜めの向きに走るので、1966年の側から谷に沿って斜め上に見下ろす
      hinoeuma: { target: [4.5, 1.2, 6.0], dir: [-0.6, 0.76, 0.4], fov: 33, box: years(1964, 2025, 0, zf), margin: 0.98, onTop: true },
      'dankai-jr': { target: [5.6, 1.4, 6.6], dir: [-0.18, 0.62, 0.76], fov: 33, box: years(1970, 2025, 0, zf), margin: 0.98, onTop: true },
      cut2025: { target: [TX(2025) - 2.5, 2.0, 0], dir: [0.8, 0.46, 0.52], fov: 33, box: 'all', margin: 0.96, quiet: true },
      'pyramid-front': { ortho: true, target: cut => [TX(cut), 3.6, 0], dir: [1, 0, 0], view: 9.0, fitW: 22.5, quiet: true },
    },
    pyramid: {
      overview: { target: [0, 4.8, -1.0], dir: [-0.62, 0.34, 0.72], fov: 30, box: 'all', margin: 0.94 },
      war: { target: [0, 3.9, PZ(1950)], dir: [-0.72, 0.32, 0.62], fov: 30, fitR: 11.2 },
      dankai: { target: [0, 4.6, PZ(1985)], dir: [-0.66, 0.32, 0.68], fov: 30, fitR: 9.4 },
      hinoeuma: { target: [0, 4.0, PZ(1995)], dir: [-0.64, 0.3, 0.7], fov: 30, fitR: 8.8 },
      'dankai-jr': { target: [0, 3.8, PZ(2000)], dir: [-0.6, 0.3, 0.74], fov: 30, fitR: 8.8 },
      cut2025: { target: [0, 5.0, PZ(2025) - 3], dir: [-0.45, 0.28, 0.85], fov: 30, box: 'all', margin: 0.96 },
      'pyramid-front': { ortho: true, target: cut => [0, 5.3, PZ(cut)], dir: [0, 0, 1], box: 'front', margin: 0.94 },
    },
  };
}

/* ---------------------------------------------------------------- 面の材質（断面の未来側を消す／淡くする） */
function surfaceMaterial(U, ghost) {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide,
    transparent: ghost, depthWrite: !ghost,
  });
  m.onBeforeCompile = sh => {
    sh.uniforms.uCut = U.uCut; sh.uniforms.uPast = U.uPast; sh.uniforms.uGhost = U.uGhost;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aYear;\nvarying float vYear;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvYear = aYear;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uCut;\nuniform float uPast;\nuniform float uGhost;\nvarying float vYear;')
      .replace('#include <color_fragment>', ghost
        ? `#include <color_fragment>
           if (!(vYear > uCut + 0.001)) discard;
           diffuseColor.a *= uGhost;`
        : `#include <color_fragment>
           if (vYear > uCut + 0.001) discard;`)
      // 淡くする処理は光の計算のあとに行う（影の側も白に寄せる）
      .replace('#include <opaque_fragment>', ghost
        ? `#include <opaque_fragment>
           gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), 0.45);`
        : `#include <opaque_fragment>
           if (vYear < uCut - 0.001) gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), uPast);`);
  };
  m.customProgramCacheKey = () => (ghost ? 'mountain-ghost' : 'mountain-solid');
  return m;
}

export function createMountain({ canvas, data, reducedMotion = false }) {
  if (!canvas) throw new Error('createMountain: canvas が必要です');
  const M = makeModel(data);
  const PRE = presetTable(M);
  const disposables = [];
  const track = o => { disposables.push(o); return o; };

  /* ---- three 基本 ---- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setClearColor(0xffffff, 1);
  renderer.localClippingEnabled = true;
  let W = Math.max(1, canvas.clientWidth || canvas.width || 300);
  let H = Math.max(1, canvas.clientHeight || canvas.height || 150);
  // 狭い画面（幅 600px 未満）は描画の負荷を下げるため、pixelRatio の上限を 1.5 にする
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, W < 600 ? 1.5 : 2);
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(W, H, false);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfd3d8, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.35); sun.position.set(-6, 14, 9); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35); fill.position.set(8, 5, -6); scene.add(fill);
  const front = new THREE.DirectionalLight(0xffffff, 0.0); front.position.set(0, 4, 20); scene.add(front);

  const persp = new THREE.PerspectiveCamera(33, W / H, 0.1, 400);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  let camera = persp;

  /* ---- 状態 ---- */
  const state = { form: 'terrain', camera: 'overview', cutYear: null, highlight: [...COHORT_IDS], orbit: false };
  let formT = 0;                 // 0＝地形型、1＝ピラミッド型（表示中の補間値）
  let formAnim = null, camAnim = null;
  let flight = null;             // 飛行中のフライト（fly）
  let restFlight = null;         // 終わったフライト（振り返りの視点で止まっている間。resize で置き直す）
  const U = { uCut: { value: NO_CUT }, uPast: { value: 0 }, uGhost: { value: 0.16 } };
  const clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), NO_CUT);

  /* ---- 補間する頂点配列の登録 ---- */
  const morphs = new Map();      // key → { cur, A, B, after }
  const addMorph = (key, cur, A, B, after) => { morphs.set(key, { cur, A, B, after }); lerpInto(cur, A, B, formT); after && after(); };
  function applyMorph(final) {
    for (const m of morphs.values()) { lerpInto(m.cur, m.A, m.B, formT); m.after && m.after(final); }
    for (const o of gpuMorph) o.morphTargetInfluences[0] = formT;
  }

  /* ---- 面と壁 ---- */
  const solidMat = track(surfaceMaterial(U, false));
  const ghostMat = track(surfaceMaterial(U, true));
  const surfaces = {};           // sex → { mesh, ghost, meta, cur }
  // 面・壁・補助線・印は GPU の morphTargets で補間する（変形中に頂点を送り直さない）
  const gpuMorph = [];
  function morphGeometry(geo, A, B, withNormals, color, year, index) {
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(A), 3));
    if (color) geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
    if (year) geo.setAttribute('aYear', new THREE.BufferAttribute(year, 1));
    if (index) geo.setIndex(index);
    geo.morphAttributes.position = [new THREE.BufferAttribute(new Float32Array(B), 3)];
    geo.morphTargetsRelative = false;
    if (withNormals) {
      const pos = geo.attributes.position, normals = [];
      for (const P of [B, A]) { pos.array.set(P); geo.computeVertexNormals(); normals.push(new Float32Array(geo.attributes.normal.array)); }
      geo.morphAttributes.normal = [new THREE.BufferAttribute(normals[0], 3)];
      geo.setAttribute('normal', new THREE.BufferAttribute(normals[1], 3));
    }
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    return geo;
  }
  function gpuObj(obj) { obj.updateMorphTargets(); obj.morphTargetInfluences[0] = formT; gpuMorph.push(obj); return obj; }
  for (const sex of SEXES) {
    const src = buildSurface(M, sex);
    const sGeo = track(morphGeometry(new THREE.BufferGeometry(), src.posA, src.posB, true, src.color, src.year, src.index));
    const mesh = gpuObj(new THREE.Mesh(sGeo, solidMat)); mesh.userData.kind = 'surface'; mesh.userData.sex = sex;
    const ghost = gpuObj(new THREE.Mesh(sGeo, ghostMat)); ghost.renderOrder = 3; ghost.visible = false;
    scene.add(mesh, ghost);
    const w = buildWalls(M, sex);
    const wGeo = track(morphGeometry(new THREE.BufferGeometry(), w.posA, w.posB, true, w.color, w.year, null));
    const wall = gpuObj(new THREE.Mesh(wGeo, solidMat)), wallGhost = gpuObj(new THREE.Mesh(wGeo, ghostMat));
    wallGhost.renderOrder = 3; wallGhost.visible = false;
    scene.add(wall, wallGhost);
    surfaces[sex] = { mesh, ghost, wallGhost, meta: src.meta, A: src.posA, B: src.posB };

    // 面の上の白い補助線
    const g = buildSurfaceGrid(M, sex);
    const gGeo = track(morphGeometry(new THREE.BufferGeometry(), g.posA, g.posB, false));
    const gl = gpuObj(new THREE.LineSegments(gGeo, track(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, clippingPlanes: [clipPlane] }))));
    gl.renderOrder = 1;
    scene.add(gl);
  }

  /* ---- openAge の印 ---- */
  const marks = buildOpenMarks(M);
  {
    const geo = track(morphGeometry(new THREE.BufferGeometry(), marks.posA, marks.posB, false));
    const pts = gpuObj(new THREE.Points(geo, track(new THREE.PointsMaterial({ color: 0x8a8a8a, size: 2.6, sizeAttenuation: false, clippingPlanes: [clipPlane] }))));
    scene.add(pts);
  }

  /* ---- 太い線（糸・断面の輪郭・断面の枠） ---- */
  const lineMats = [];
  function lineMat(opts) {
    const m = track(new LineMaterial({ color: 0xffffff, worldUnits: false, ...opts }));
    if (opts.dashed) m.dashed = true;
    m.resolution.set(W, H); lineMats.push(m); return m;
  }
  /** 補間できる LineSegments2 を作る。colors は線分ごとに rgb×2 */
  function morphLines(key, A, B, colors, mat, meta) {
    const geo = track(new LineSegmentsGeometry());
    const cur = new Float32Array(A.length);
    lerpInto(cur, A, B, formT);
    geo.setPositions(cur);
    if (colors) geo.setColors(colors);
    const obj = new LineSegments2(geo, mat);
    obj.frustumCulled = false;
    if (mat.dashed) obj.computeLineDistances();
    obj.userData.meta = meta; obj.userData.cur = cur;
    addMorph(key, cur, A, B, final => {
      geo.attributes.instanceStart.data.needsUpdate = true;
      if (final) { geo.computeBoundingBox(); geo.computeBoundingSphere(); if (mat.dashed) obj.computeLineDistances(); }
    });
    return obj;
  }
  const narrow = () => Math.min(W, H) < 520;
  function threadGroup(key, births, { strong, allDashed }) {
    const t = buildThreads(M, births, { allDashed });
    const objs = [];
    for (const [kind, g] of [['solid', t.solid], ['dashed', t.dashed]]) {
      if (!g.meta.length) continue;
      const colors = new Float32Array(g.sex.length * 6);
      g.sex.forEach((sex, k) => {
        const c = hexToRgb(strong ? (sex === 'male' ? COLORS.maleStrong : COLORS.femaleStrong) : (sex === 'male' ? COLORS.maleThin : COLORS.femaleThin));
        colors.set([...c, ...c], k * 6);
      });
      const mat = lineMat({
        vertexColors: true, linewidth: strong ? (narrow() ? 2.2 : 2.8) : 1,
        transparent: !strong, opacity: strong ? 1 : 0.32, dashed: kind === 'dashed',
        dashSize: strong ? 0.28 : 0.18, gapSize: strong ? 0.2 : 0.14, clippingPlanes: [clipPlane],
      });
      mat.userData = { strong };
      const obj = morphLines(`thread-${key}-${kind}`, new Float32Array(g.posA), new Float32Array(g.posB), colors, mat, g.meta);
      obj.renderOrder = strong ? 5 : 4;
      obj.userData.kind = 'thread'; obj.userData.cohort = strong ? key : null;
      scene.add(obj); objs.push(obj);
    }
    return objs;
  }
  const baseThreads = threadGroup('base', baseBirthYears(M), { strong: false, allDashed: false });
  const cohortThreads = {};
  for (const c of COHORTS) {
    const births = []; for (let b = c.from; b <= c.to; b++) births.push(b);
    cohortThreads[c.id] = threadGroup(c.id, births, { strong: true, allDashed: !!c.dashed });
  }

  /* ---- 床・軸（形ごとに用意し、補間に合わせて入れ替える） ---- */
  const axesT = new THREE.Group(), axesP = new THREE.Group(), axesPFront = new THREE.Group();
  axesP.add(axesPFront); scene.add(axesT, axesP);
  const fadeMats = { T: [], P: [] };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  function thin(group, key, pts, color, opacity = 1) {
    const g = track(new THREE.BufferGeometry().setFromPoints(pts));
    const m = track(new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
    m.userData.base = opacity; fadeMats[key].push(m);
    group.add(new THREE.LineSegments(g, m));
  }
  function band(group, key, w, d, x, z, color) {
    const m = track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
    m.userData.base = 0.75; fadeMats[key].push(m);
    const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(w, d)), m);
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, 0.004, z); group.add(mesh);
  }
  const labels = new LabelSet(); scene.add(labels.group);
  // 文字が重なるときは priority の高いものを残す（labels.js）
  const tick = { size: 10.5, color: '#6b6b6b' }, tickEnd = { ...tick, priority: 1 };
  const axName = { size: 12, color: '#333', weight: 700, priority: 2 };
  // 面のラベルは面の後ろに隠れないよう、手前に描く
  const mLab = { size: 11.5, color: COLORS.maleStrong, weight: 700, priority: 3, onTop: true };
  const fLab = { size: 11.5, color: COLORS.femaleStrong, weight: 700, priority: 3, onTop: true };
  const depthTicks = [], terrainTicks = [];   // 正面から見ると重なる、奥行き（年）の目盛り
  const gaps = [];
  for (let i = 0; i + 1 < M.years.length; i++) if (!M.consecutive(i)) gaps.push([M.years[i].year, M.years[i + 1].year]);
  const decade = []; for (let yr = Math.ceil(M.yMin / 10) * 10; yr <= M.yMax; yr += 10) decade.push(yr);
  const vTicks = [0, 500000, 1000000, 1500000].filter(v => v <= M.vmax);
  const vLabel = v => (v ? `${v / 10000}万` : '0');
  {
    // 地形型
    const TX = M.TX, TZ = M.TZ, TH = M.TH, x0 = TX(M.yMin), x1 = TX(M.yMax), zf = TZ('male', 0), zb = TZ('female', 0);
    const segs = [];
    for (const yr of [...decade, M.yMax]) segs.push(V(TX(yr), 0, zb), V(TX(yr), 0, zf));
    for (const a of [0, 20, 40, 60, 80]) for (const s of SEXES) segs.push(V(x0, 0, TZ(s, a)), V(x1, 0, TZ(s, a)));
    thin(axesT, 'T', segs, 0xd8d8d8);
    thin(axesT, 'T', [V(x0, 0, 0), V(x1, 0, 0)], 0x999999);
    for (const [g0, g1] of gaps) {
      band(axesT, 'T', TX(g1) - TX(g0), zf - zb, (TX(g0) + TX(g1)) / 2, (zf + zb) / 2, 0xe9e9e9);
      thin(axesT, 'T', [V(TX(g0), 0.02, zb), V(TX(g0), 0.02, zf), V(TX(g1), 0.02, zb), V(TX(g1), 0.02, zf)], 0xaaaaaa);
    }
    const hx = x1, vs = [V(hx, 0, zf), V(hx, TH(M.vmax), zf)];
    for (const v of vTicks) vs.push(V(hx, TH(v), zf), V(hx + 0.25, TH(v), zf));
    thin(axesT, 'T', vs, 0x999999);
    for (let yr = Math.ceil(M.yMin / 20) * 20; yr < M.yMax - 4; yr += 20) labels.add(String(yr), [TX(yr), 0, zf + 0.9], null, yr === M.yMin ? tickEnd : tick);
    labels.add(String(M.yMax), [x1, 0, zf + 0.9], null, tickEnd);
    labels.add('年 →', [0, 0, zf + 2.0], null, axName);
    for (const a of [0, 20, 40, 60, 80]) for (const s of SEXES) labels.add(`${a}歳`, [x0 - 0.9, 0, TZ(s, a)], null, a ? tick : tickEnd);
    labels.add(`${M.ageMax}歳`, [x0 - 0.9, 0, 0], null, tickEnd);
    labels.add('年齢', [x0 - 2.4, 0, 5.2], null, axName); labels.add('年齢', [x0 - 2.4, 0, -5.2], null, axName);
    for (const v of vTicks) labels.add(v ? `${v / 10000}万人` : '0', [hx + 1.3, TH(v), zf], null, v ? tick : tickEnd);
    labels.add('人数（各歳）', [hx + 1.3, TH(M.vmax) + 0.9, zf], null, axName);
    labels.add('◀ 男性の面', [x0 + 0.9, 0.1, 7.2], null, mLab);
    labels.add('◀ 女性の面', [x0 + 0.9, 0.1, -7.2], null, fLab);
    terrainTicks.push(...labels.items);
  }
  {
    // 立体ピラミッド型
    const PZ = M.PZ, PY = M.PY, PX = M.PX, zf = PZ(M.yMax), z0 = PZ(M.yMin), xw = PX(M.vmax);
    const segs = [];
    for (const yr of decade.filter(y => y % 20 === 0)) segs.push(V(-xw, 0, PZ(yr)), V(xw, 0, PZ(yr)));
    segs.push(V(-xw, 0, z0), V(-xw, 0, zf), V(xw, 0, z0), V(xw, 0, zf));
    thin(axesP, 'P', segs, 0xdddddd);
    thin(axesP, 'P', [V(0, 0, z0), V(0, 0, zf)], 0xbbbbbb);
    for (const [g0, g1] of gaps) band(axesP, 'P', 2 * xw, PZ(g1) - PZ(g0), 0, (PZ(g0) + PZ(g1)) / 2, 0xe9e9e9);
    // 正面の目盛り（断面の年に合わせて前後に動く）
    const gz = zf + 0.05, fs = [], fs0 = [];
    for (const a of [20, 40, 60, 80, 100]) fs.push(V(-xw, PY(a), gz), V(xw, PY(a), gz));
    for (const v of vTicks) for (const s of [-1, 1]) if (v || s > 0) fs.push(V(s * PX(v), 0, gz), V(s * PX(v), PY(M.ageMax), gz));
    fs0.push(V(-xw, 0, gz), V(xw, 0, gz));
    thin(axesPFront, 'P', fs, 0x777777, 0.22);
    thin(axesPFront, 'P', fs0, 0x777777, 0.8);
    const F = { ...tick, front: true }, FA = { ...axName, front: true };
    for (const a of [0, 20, 40, 60, 80, 100]) labels.add(`${a}歳`, null, [-xw - 0.85, PY(a), zf], a % 100 ? F : { ...F, priority: 1 });
    for (const v of vTicks) for (const s of [-1, 1]) if (v || s > 0) labels.add(vLabel(v), null, [s * PX(v), -0.5, zf], F);
    labels.add('人数（各歳）', null, [0, -1.15, zf], FA);
    labels.add('年齢', null, [-xw - 1.75, PY(50), zf], FA);
    labels.add('◀ 男性', null, [-xw * 0.6, PY(M.ageMax) + 0.55, zf], { ...mLab, front: true });
    labels.add('女性 ▶', null, [xw * 0.6, PY(M.ageMax) + 0.55, zf], { ...fLab, front: true });
    for (const yr of [M.yMin, 1950, 1980].filter(y => y > M.yMin - 1 && y < M.yMax - 10)) depthTicks.push(labels.add(String(yr), null, [-xw - 1.0, 0, PZ(yr)], tick));
    depthTicks.push(labels.add('年（奥ほど過去）', null, [-xw - 2.6, 0, (z0 + zf) / 2 - 2], axName));
  }
  const cutLabel = labels.add('断面', [0, 0, 0], [0, 0, 0], { size: 12, color: '#445', weight: 700, onTop: true, priority: 4 });
  cutLabel.hidden = true;

  /* ---- 断面 ---- */
  const cutGroup = new THREE.Group(); scene.add(cutGroup);
  const cutMat = track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
  let cutObjs = [];
  const frameMat = lineMat({ color: 0x5c6f86, linewidth: 1.4, dashed: true, dashSize: 0.25, gapSize: 0.15 });
  let frameObj = null;
  const effCut = () => (state.cutYear != null ? state.cutYear : (state.camera === 'pyramid-front' ? M.yMax : null));
  function highlightBirths() {
    const set = new Set();
    for (const id of state.highlight) { const c = COHORTS.find(x => x.id === id); if (c) for (let b = c.from; b <= c.to; b++) set.add(b); }
    return set;
  }
  function clearCut() {
    for (const o of cutObjs) { cutGroup.remove(o); o.geometry.dispose(); }
    for (const k of [...morphs.keys()]) if (k.startsWith('cut-')) morphs.delete(k);
    cutObjs = [];
  }
  function rebuildCut() {
    clearCut();
    const yr = effCut();
    const i = yr == null ? undefined : M.index.get(yr);
    if (i !== undefined) {
      const hb = highlightBirths();
      for (const sex of SEXES) {
        const s = buildCutSlab(M, i, sex, hb);
        if (!s.posA.length) continue;
        const geo = new THREE.BufferGeometry();
        const A = new Float32Array(s.posA), B = new Float32Array(s.posB), cur = new Float32Array(A.length);
        geo.setAttribute('position', new THREE.BufferAttribute(cur, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(s.color), 3));
        const nA = new Float32Array(A.length), nB = new Float32Array(A.length);
        for (let k = 0; k < A.length; k += 3) { nA[k] = 1; nB[k + 2] = 1; }
        const nrm = new Float32Array(A.length);
        geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
        addMorph('cut-slab-' + sex, cur, A, B, () => { geo.attributes.position.needsUpdate = true; geo.computeBoundingSphere(); });
        addMorph('cut-slabn-' + sex, nrm, nA, nB, () => { geo.attributes.normal.needsUpdate = true; });
        const mesh = new THREE.Mesh(geo, cutMat); mesh.renderOrder = 2; mesh.frustumCulled = false;
        cutGroup.add(mesh); cutObjs.push(mesh);
        const mat = sex === 'male' ? outlineMats.male : outlineMats.female;
        const line = morphLines('cut-out-' + sex, new Float32Array(polylineToSegments(s.outA)), new Float32Array(polylineToSegments(s.outB)), null, mat, null);
        line.renderOrder = 6; cutGroup.add(line); cutObjs.push(line);
      }
    }
    // 枠と見出し（明示の断面のときだけ）
    if (frameObj) { scene.remove(frameObj); frameObj.geometry.dispose(); morphs.delete('cut-frame'); frameObj = null; }
    const showFrame = state.cutYear != null;
    if (yr != null && showFrame) {
      const x = M.TX(yr) + 0.03, z = M.PZ(yr) + 0.03, h = M.TH(M.vmax) + 0.3, zf = M.TZ('male', 0), zb = M.TZ('female', 0);
      const xw = M.PX(M.vmax) + 0.3, top = M.PY(M.ageMax) + 0.3;
      const A = polylineToSegments([x, 0, zb, x, h, zb, x, h, zf, x, 0, zf]);
      const B = polylineToSegments([-xw, 0, z, -xw, top, z, xw, top, z, xw, 0, z]);
      frameObj = morphLines('cut-frame', new Float32Array(A), new Float32Array(B), null, frameMat, null);
      frameObj.renderOrder = 6; scene.add(frameObj);
    }
    cutLabel.hidden = !(yr != null && showFrame);
    if (yr != null) {
      labels.setText(cutLabel, `${yr}年の断面`);
      cutLabel.posA = [M.TX(yr) + 0.3, M.TH(M.vmax) + 0.9, 0];
      cutLabel.posB = [0, M.PY(M.ageMax) + 1.25, M.PZ(yr)];
    }
  }
  const outlineMats = {
    male: lineMat({ color: new THREE.Color(COLORS.maleStrong).getHex(), linewidth: 2 }),
    female: lineMat({ color: new THREE.Color(COLORS.femaleStrong).getHex(), linewidth: 2 }),
  };

  function updateCutUniforms() {
    const yr = effCut();
    U.uCut.value = yr == null ? NO_CUT : yr;
    // 補間の途中では、近い方の形の向きで切る
    if (yr == null) { clipPlane.normal.set(-1, 0, 0); clipPlane.constant = NO_CUT; }
    else if (formT < 0.5) { clipPlane.normal.set(-1, 0, 0); clipPlane.constant = M.TX(yr) + 0.005; }
    else { clipPlane.normal.set(0, 0, -1); clipPlane.constant = M.PZ(yr) + 0.005; }
    const ghost = yr != null && yr < M.yMax;
    for (const sex of SEXES) { surfaces[sex].ghost.visible = ghost; surfaces[sex].wallGhost.visible = ghost; }
  }
  /**
   * ピラミッド型を正面に近い向きで見ているときは、断面より奥（過去）の面を淡くし、奥の年を通る糸を隠す。
   * カメラのプリセット名ではなく、形と視線の向きで決める（free で正面から見た場合も同じ扱い）。
   */
  let frontK = 0, isFront = false;
  function updateFront() {
    const dz = tmpV.copy(camera.position).sub(controls.target).normalize().z;
    frontK = clamp01((dz - FRONT_DOT[0]) / (FRONT_DOT[1] - FRONT_DOT[0])) * clamp01((formT - 0.5) * 2);
    U.uPast.value = effCut() != null ? 0.8 * frontK : 0;
    front.intensity = 0.5 * frontK;
    const f = frontK > 0.5;
    if (f !== isFront) { isFront = f; applyHighlight(); }
  }

  /* ---- 表示の更新 ---- */
  function applyHighlight() {
    // ピラミッド型を正面から見ているときは、奥の年を通る糸は描かない
    const front = isFront;
    // フライト中は、その世代の糸だけを強調する
    const on = new Set(flight ? [flight.cohort] : state.highlight);
    const top = threadsOnTop() && !flight;
    for (const c of COHORTS) for (const o of cohortThreads[c.id]) {
      o.visible = !front && on.has(c.id);
      o.material.depthTest = !top; o.renderOrder = top ? 9 : 5;
    }
    for (const o of baseThreads) o.visible = !front;
    for (const l of depthTicks) l.hidden = front;
    const quiet = !!(PRE.terrain[state.camera] || {}).quiet || !!flight;
    for (const l of terrainTicks) l.hidden = quiet;
  }
  const threadsOnTop = () => state.form === 'terrain' && !!(PRE.terrain[state.camera] || {}).onTop;
  function applyForm() {
    const t = formT;
    const wT = Math.max(0, 1 - t * 2), wP = Math.max(0, t * 2 - 1);
    for (const m of fadeMats.T) m.opacity = m.userData.base * wT;
    for (const m of fadeMats.P) m.opacity = m.userData.base * wP;
    axesT.visible = wT > 0.01; axesP.visible = wP > 0.01;
    const yr = effCut();
    axesPFront.position.z = yr == null ? 0 : M.PZ(yr) - M.PZ(M.yMax);
  }

  /* ---- カメラ ---- */
  const tmpV = new THREE.Vector3();
  function presetPose(name, form) {
    const p = PRE[form][name]; if (!p) return null;
    const cut = effCut() ?? M.yMax;
    const target = new THREE.Vector3(...(typeof p.target === 'function' ? p.target(cut) : p.target));
    const dir = new THREE.Vector3(...p.dir).normalize();
    const asp = W / H;
    if (p.ortho) {
      if (p.box) {
        const half = fitView(fitPoints(name, form, p, cut), target, dir, false, 1, asp, p.margin);
        return { ortho: true, target, dir, viewH: half * 2, dist: 60 };
      }
      const viewH = Math.max(p.view, p.fitW / asp);
      return { ortho: true, target, dir, viewH, dist: 60 };
    }
    const vf = THREE.MathUtils.degToRad(p.fov) / 2, hf = Math.atan(Math.tan(vf) * asp);
    if (p.box) {
      // 範囲（と目盛りの文字）の投影が画面に収まる距離を求め、投影の中心が画面の中心に来るよう注視点を動かす
      const dist = fitView(fitPoints(name, form, p, cut), target, dir, true, Math.tan(vf), Math.tan(hf), p.margin);
      return { ortho: false, target, dir, fov: p.fov, dist };
    }
    return { ortho: false, target, dir, fov: p.fov, dist: p.fitR / Math.sin(Math.min(vf, hf)) };
  }
  // 内容（面・軸・目盛り）の外形
  const CONTENT = {
    terrain: [[M.TX(M.yMin), M.TX(M.yMax)], [0, M.TH(M.vmax)], [M.TZ('female', 0), M.TZ('male', 0)]],
    pyramid: [[-M.PX(M.vmax), M.PX(M.vmax)], [0, M.PY(M.ageMax)], [M.PZ(M.yMin), M.PZ(M.yMax)]],
  };
  const labelScale = () => Math.max(0.8, Math.min(1, W / 640));
  /**
   * 画面に収める点の一覧：範囲の角（大きさ 0）と、その形で出る文字（文字の大きさを px で持つ）。
   * 範囲を指定したプリセットでは、範囲の近くにある文字だけを含める。
   */
  function fitPoints(name, form, p, cut) {
    const t = form === 'pyramid' ? 1 : 0;
    let box;
    if (p.box === 'front') {
      const xw = M.PX(M.vmax), z = M.PZ(cut);
      box = [[-xw, xw], [0, M.PY(M.ageMax)], [z, z]];
    } else box = p.box === 'all' ? CONTENT[form] : p.box;
    const pts = [];
    for (const x of box[0]) for (const y of box[1]) for (const z of box[2]) pts.push({ p: [x, y, z], hx: 0, hy: 0 });
    const quiet = form === 'terrain' && !!(PRE.terrain[name] || {}).quiet;
    const offB = cut != null ? M.PZ(cut) - M.PZ(M.yMax) : 0;
    const pad = 1.8, k = labelScale() / 2;
    for (const it of labels.items) {
      const pos = t ? it.posB : it.posA;
      if (!pos) continue;
      if (it === cutLabel && cutLabel.hidden) continue;
      if (quiet && terrainTicks.includes(it)) continue;
      if (t && p.box === 'front' && !it.style.front && it !== cutLabel) continue;
      if (t && name === 'pyramid-front' && depthTicks.includes(it)) continue;
      const q = [pos[0], pos[1], pos[2] + (t && it.style.front ? offB : 0)];
      if (p.box !== 'all' && p.box !== 'front' && !q.every((v, i) => v >= box[i][0] - pad && v <= box[i][1] + pad)) continue;
      pts.push({ p: q, hx: it.pxW * k, hy: it.pxH * k });
    }
    return pts;
  }
  /**
   * 点の一覧の投影が、画面の幅と高さの margin 倍に収まる大きさを求める。target は投影の中心が画面中央に来るよう動かす。
   * 透視投影なら距離、正射影なら縦の半分の大きさを返す（どちらも大きいほど小さく映る）。
   */
  function fitView(pts, target, dir, persp, tanV, tanH, margin = 0.94) {
    const f = dir, r = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), f).normalize();
    const u = new THREE.Vector3().crossVectors(f, r);
    const ext = s => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const pt of pts) {
        const q = tmpV.set(pt.p[0], pt.p[1], pt.p[2]).sub(target);
        const dep = persp ? s - q.dot(f) : s;
        if (dep <= 0.05) return null;
        const nx = q.dot(r) / (dep * tanH), ny = q.dot(u) / (dep * tanV);
        const ex = pt.hx * 2 / W, ey = pt.hy * 2 / H;
        x0 = Math.min(x0, nx - ex); x1 = Math.max(x1, nx + ex); y0 = Math.min(y0, ny - ey); y1 = Math.max(y1, ny + ey);
      }
      return { x0, x1, y0, y1 };
    };
    const fits = s => { const e = ext(s); return !!e && e.x1 - e.x0 <= 2 * margin && e.y1 - e.y0 <= 2 * margin; };
    const search = () => {
      let lo = 0.1, hi = 600;
      for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
      return hi;
    };
    let s = search();
    for (let i = 0; i < 5; i++) {
      const e = ext(s); if (!e) break;
      target.addScaledVector(r, (e.x0 + e.x1) / 2 * s * tanH).addScaledVector(u, (e.y0 + e.y1) / 2 * s * tanV);
      s = search();
    }
    return s;
  }
  /** 正射影の姿勢を、画角の小さい透視投影に置き換える（遷移のため） */
  function perspEquivalent(pose) {
    if (!pose.ortho) return pose;
    const fov = ORTHO_EQ_FOV, d = (pose.viewH / 2) / Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    return { ortho: false, target: pose.target.clone(), dir: pose.dir.clone(), fov, dist: d };
  }
  function currentPose() {
    const target = controls.target.clone();
    const off = tmpV.copy(camera.position).sub(target);
    const dist = off.length(), dir = off.clone().normalize();
    if (camera === ortho) return { ortho: true, target, dir, viewH: (ortho.top - ortho.bottom) / ortho.zoom, dist };
    return { ortho: false, target, dir, fov: persp.fov, dist };
  }
  function setPose(pose) {
    if (pose.ortho) {
      const hh = pose.viewH / 2, asp = W / H;
      ortho.left = -hh * asp; ortho.right = hh * asp; ortho.top = hh; ortho.bottom = -hh; ortho.zoom = 1;
      ortho.updateProjectionMatrix();
      useCamera(ortho);
    } else {
      persp.fov = pose.fov; persp.aspect = W / H; persp.updateProjectionMatrix();
      useCamera(persp);
    }
    camera.position.copy(pose.target).addScaledVector(pose.dir, pose.dist);
    camera.up.set(0, 1, 0);
    camera.lookAt(pose.target);
    controls.target.copy(pose.target);
    camera.updateMatrixWorld(true);
  }
  function useCamera(cam) {
    if (camera === cam) return;
    camera = cam; controls.object = cam;
  }
  // 画角と距離を別々に補間すると、注視点で見える高さが縮んでから膨らむ。見える高さを補間し、距離はそこから決める
  const viewHeight = p => 2 * p.dist * Math.tan(THREE.MathUtils.degToRad(p.fov) / 2);
  function lerpPose(a, b, t) {
    const dir = a.dir.clone().lerp(b.dir, t);
    if (dir.lengthSq() < 1e-6) dir.copy(b.dir); dir.normalize();
    const fov = a.fov + (b.fov - a.fov) * t;
    const h = Math.exp(Math.log(viewHeight(a)) + (Math.log(viewHeight(b)) - Math.log(viewHeight(a))) * t);
    return { ortho: false, target: a.target.clone().lerp(b.target, t), dir, fov, dist: h / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2)) };
  }
  function moveCamera(name, animate) {
    if (name === 'free') return;
    moveTo(presetPose(name, state.form), animate);
  }
  function moveTo(to, animate) {
    if (!to) return;
    if (!animate || reducedMotion) { camAnim = null; setPose(to); requestRender(); return; }
    const from = perspEquivalent(currentPose());
    if (camera === ortho) setPose(from);
    camAnim = { from, to, start: performance.now() };
    requestRender();
  }

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.enabled = false;
  controls.addEventListener('change', () => requestRender());
  controls.addEventListener('start', () => { camAnim = null; restFlight = null; });   // free で触ったら、視点の移動をやめて操作に従う

  /* ---- 尾根沿いのフライト ---- */
  const DEG = THREE.MathUtils.degToRad;
  // 飛行中の世代の糸（男性の面）。谷を通る世代（丙午・終戦前後）でも見えるよう、面より手前に太く描く
  let flightLines = [];
  function showFlightThread(c) {
    hideFlightThread();
    const births = []; for (let b = c.from; b <= c.to; b++) births.push(b);
    const t = buildThreads(M, births, { allDashed: !!c.dashed });
    for (const [kind, g] of [['solid', t.solid], ['dashed', t.dashed]]) {
      const pos = [];
      g.sex.forEach((sex, k) => { if (sex === 'male') pos.push(...g.posA.slice(k * 6, k * 6 + 6)); });
      if (!pos.length) continue;
      const geo = new LineSegmentsGeometry(); geo.setPositions(pos);
      // 飛ぶたびに作り直すので、track（dispose の一覧）には入れず、hideFlightThread で捨てる
      const mat = new LineMaterial({
        color: new THREE.Color(COLORS.maleStrong).getHex(), worldUnits: false, linewidth: narrow() ? 3 : 3.6,
        dashSize: 0.28, gapSize: 0.2, depthTest: false, transparent: true, opacity: 0.95, clippingPlanes: [clipPlane],
      });
      mat.dashed = kind === 'dashed'; mat.resolution.set(W, H); lineMats.push(mat);
      const obj = new LineSegments2(geo, mat);
      obj.frustumCulled = false; obj.renderOrder = 9;
      if (mat.dashed) obj.computeLineDistances();
      scene.add(obj); flightLines.push(obj);
    }
  }
  function hideFlightThread() {
    for (const o of flightLines) {
      scene.remove(o); o.geometry.dispose(); o.material.dispose();
      const i = lineMats.indexOf(o.material); if (i >= 0) lineMats.splice(i, 1);
    }
    flightLines = [];
  }
  const flyPose = (path, p) => {
    const { pos, look } = path.poseAt(p);
    const target = new THREE.Vector3(...look), off = new THREE.Vector3(...pos).sub(target);
    return { ortho: false, target, dir: off.clone().normalize(), fov: FLIGHT.fov, dist: off.length() };
  };
  // 終わったら、尾根を振り返って全体が見える位置（2025年の側の、若い年齢の側の上）に置く
  function lookBackPose(f) {
    const P = f.path, b = P.box;
    const target = new THREE.Vector3((b[0][0] + b[0][1]) / 2, b[1][1] * 0.4, (b[2][0] + b[2][1]) / 2);
    const dir = new THREE.Vector3(P.fwd[0] * 0.6 + P.right[0] * 0.7, 0.95, P.fwd[2] * 0.6 + P.right[2] * 0.7).normalize();
    const pts = [];
    for (const x of b[0]) for (const y of b[1]) for (const z of b[2]) pts.push({ p: [x, y, z], hx: 0, hy: 0 });
    const fov = f.savedFov, vf = DEG(fov) / 2, hf = Math.atan(Math.tan(vf) * W / H);
    const dist = fitView(pts, target, dir, true, Math.tan(vf), Math.tan(hf), 0.9);
    return { ortho: false, target, dir, fov, dist };
  }
  const flightInfo = (f, p) => {
    const info = f.path.infoAt(p);
    return { cohort: f.cohort, progress: p, birthYear: f.path.birth, year: info.year, age: info.age, value: info.value, kazoe: info.kazoe };
  };
  // 面にめり込まないよう、カメラの位置の近くの面より上に保つ（なじませる途中も含めて）
  function keepAbove() {
    const c = camera.position, floor = localMaxHeight(M, c.x, c.z, 0.3, 4) + 0.15;
    if (c.y < floor) { c.y = floor; camera.lookAt(controls.target); camera.updateMatrixWorld(true); }
  }
  function stepFlight(now) {
    const f = flight;
    const el = now - f.start, p = clamp01(el / f.duration);
    let pose = flyPose(f.path, p);
    if (el < FLY_BLEND_MS && f.from) pose = lerpPose(f.from, pose, ease(el / FLY_BLEND_MS));
    setPose(pose); keepAbove();
    f.progress = p;
    f.clearance = camera.position.y - surfaceHeight(M, camera.position.x, camera.position.z);
    const info = flightInfo(f, p);
    f.year = info.year; f.age = info.age;
    try { f.onProgress && f.onProgress(info); } catch (e) { console.error(e); }
    if (p >= 1) { finishFlight('end'); return false; }
    return true;
  }
  /** reason：'end'（最後まで飛んだ）、'user'（canvas を触った）、'stop'（stopFlight・段の切り替え） */
  function finishFlight(reason) {
    const f = flight; if (!f) return;
    flight = null;
    hideFlightThread();
    controls.enabled = state.orbit;
    if (reason === 'end') {
      restFlight = f;
      moveTo(lookBackPose(f), true);
    } else if (camera === persp) {
      // 元の画角に戻す。注視点で見える高さを変えないよう、そのぶん後ろへ下がる
      const cur = currentPose();
      const k = Math.tan(DEG(persp.fov) / 2) / Math.tan(DEG(f.savedFov) / 2);
      setPose({ ...cur, fov: f.savedFov, dist: cur.dist * k }); keepAbove();
    }
    applyHighlight(); requestRender();
    try { f.onEnd && f.onEnd({ reason, cohort: f.cohort }); } catch (e) { console.error(e); }
  }
  // 飛行中に canvas を触ったら止めて、操作に戻す（capture で先に受け、同じドラッグで回転できるようにする）
  const onFlightInterrupt = () => { if (flight) finishFlight('user'); };
  canvas.addEventListener('pointerdown', onFlightInterrupt, { capture: true });
  canvas.addEventListener('wheel', onFlightInterrupt, { capture: true, passive: true });

  /* ---- 描画ループ（必要なときだけ描く） ---- */
  let raf = 0, disposed = false;
  function requestRender() { if (!raf && !disposed) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    let more = false;
    if (formAnim) {
      const k = Math.min(1, (now - formAnim.start) / FORM_MS);
      formT = formAnim.from + (formAnim.to - formAnim.from) * ease(k);
      const done = k >= 1;
      if (done) { formT = formAnim.to; formAnim = null; }
      applyMorph(done); applyForm(); updateCutUniforms();
      more = more || !done;
    }
    if (camAnim) {
      const k = Math.min(1, (now - camAnim.start) / CAM_MS);
      if (k >= 1) { setPose(camAnim.to); camAnim = null; }
      else { setPose(lerpPose(camAnim.from, perspEquivalent(camAnim.to), ease(k))); more = true; }
    }
    if (flight) more = stepFlight(now) || more;
    render();
    if (more) requestRender();
  }
  function render() {
    const yr = effCut();
    updateFront();
    labels.update(formT, camera, W, H, yr == null ? 0 : M.PZ(yr) - M.PZ(M.yMax), labelScale());
    renderer.render(scene, camera);
  }

  /* ---- ピッキング ---- */
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line2 = { threshold: 8 };
  const ndc = new THREE.Vector2();
  const pickListeners = new Set();
  function pickAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const cut = effCut();
    const okYear = i => cut == null || M.years[i].year <= cut;
    // 面
    let surf = null;
    const sHits = raycaster.intersectObjects(SEXES.map(s => surfaces[s].mesh), false);
    for (const h of sHits) {
      const S = surfaces[h.object.userData.sex], A = S.A, B = S.B, t = formT;
      let best = -1, bd = Infinity;
      for (const v of [h.face.a, h.face.b, h.face.c]) {
        const L = k => A[v * 3 + k] + (B[v * 3 + k] - A[v * 3 + k]) * t;
        const d = tmpV.set(L(0), L(1), L(2)).distanceToSquared(h.point);
        if (d < bd) { bd = d; best = v; }
      }
      const i = S.meta[best * 2], a = S.meta[best * 2 + 1];
      if (!okYear(i)) continue;
      surf = { hit: h, result: result(h.object.userData.sex, i, a, 'surface') }; break;
    }
    // 糸（強調の糸を先に）
    const lineObjs = [];
    for (const id of state.highlight) for (const o of cohortThreads[id] || []) if (o.visible) lineObjs.push(o);
    for (const o of baseThreads) if (o.visible) lineObjs.push(o);
    let thr = null, best = Infinity;
    const lHits = raycaster.intersectObjects(lineObjs, false);
    for (const h of lHits) {
      // 山の陰に隠れた糸は拾わない（手前に描いている強調の糸は除く）
      if (surf && h.distance > surf.hit.distance + 0.4 && !(h.object.userData.cohort && !h.object.material.depthTest)) continue;
      const meta = h.object.userData.meta[h.faceIndex], cur = h.object.userData.cur, o = h.faceIndex * 6;
      // 強調の糸を優先し、そのうえでレイに最も近い端点（年）を選ぶ
      const pri = h.object.userData.cohort ? 0 : 1e6;
      for (const [i, k] of [[meta.i0, o], [meta.i1, o + 3]]) {
        if (!okYear(i)) continue;
        const d = pri + raycaster.ray.distanceSqToPoint(tmpV.set(cur[k], cur[k + 1], cur[k + 2])) / Math.max(1e-6, h.distance * h.distance);
        if (d < best) { best = d; thr = { hit: h, result: result(meta.sex, i, M.ageOf(i, meta.birthYear), 'thread') }; }
      }
    }
    return (thr || surf)?.result ?? null;
  }
  function result(sex, i, age, source) {
    const birthYear = M.birthOf(i, age), c = cohortOfBirth(birthYear);
    return { sex, birthYear, year: M.years[i].year, age, value: M.val(i, sex, age), kazoe: M.kazoe(i), source, cohort: c ? c.id : null };
  }
  const keyOf = r => (r ? `${r.sex}|${r.year}|${r.age}` : '');
  let lastHoverKey = '', hoverEvt = null, hoverRaf = 0, downAt = null;
  function emit(res, info) { for (const cb of pickListeners) { try { cb(res, info); } catch (e) { console.error(e); } } }
  function screenOf(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  const onMove = e => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    if (e.buttons) return;
    hoverEvt = e;
    if (!hoverRaf) hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0; if (!hoverEvt || disposed) return;
      const res = pickAt(hoverEvt.clientX, hoverEvt.clientY), k = keyOf(res);
      if (k !== lastHoverKey) { lastHoverKey = k; emit(res, { type: 'hover', ...screenOf(hoverEvt) }); }
    });
  };
  // ホバーで出したものだけを、ポインタが出たときに消す。タッチでは指を離すと必ず pointerleave が来るので、
  // タップで出したものは、次のタップ（何もない所なら cb(null, {type:'tap'})）で消す
  const onLeave = e => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    hoverEvt = null; if (lastHoverKey) { lastHoverKey = ''; emit(null, { type: 'hover' }); }
  };
  const onDown = e => { downAt = { x: e.clientX, y: e.clientY }; };
  const onUp = e => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y); downAt = null;
    if (moved > 6) return;
    const res = pickAt(e.clientX, e.clientY);
    if (!e.pointerType || e.pointerType === 'mouse') lastHoverKey = keyOf(res);
    emit(res, { type: 'tap', ...screenOf(e) });
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);

  /* ---- 初期化 ---- */
  applyHighlight(); applyForm(); rebuildCut(); updateCutUniforms();
  setPose(presetPose('overview', 'terrain'));
  render();

  /* ---------------------------------------------------------------- API */
  const api = {
    /** form: 'terrain' | 'pyramid'。animate（既定 true）で 700ms かけて変形する */
    setForm(form, { animate = true } = {}) {
      if (!FORMS.includes(form)) throw new Error('unknown form: ' + form);
      if (form === state.form && !formAnim) return;
      if (flight) finishFlight('stop');      // フライト中は地形型に固定する。ほかの形にするときは止める
      restFlight = null;
      state.form = form;
      applyHighlight();
      const to = form === 'pyramid' ? 1 : 0;
      if (!animate || reducedMotion) { formAnim = null; formT = to; applyMorph(true); applyForm(); updateCutUniforms(); }
      else formAnim = { from: formT, to, start: performance.now() };
      // free では、その形を見るための既定の視点（地形型は overview、ピラミッド型は斜めから全体）へ移す
      if (state.camera !== 'free') moveCamera(state.camera, animate);
      else moveTo(presetPose('overview', form), animate);
      requestRender();
    },
    /** 視点を今の段の既定に戻す。free では、今の形を見るための既定の視点（setForm と同じ）へ移す */
    resetView({ animate = true } = {}) {
      if (flight) finishFlight('stop');
      restFlight = null;
      moveTo(presetPose(state.camera === 'free' ? 'overview' : state.camera, state.form), animate);
      requestRender();
    },
    /** preset: CAMERA_PRESETS のいずれか。free は今の視点のままオービット操作を有効にする */
    setCamera(preset, { animate = true } = {}) {
      if (!CAMERA_PRESETS.includes(preset)) throw new Error('unknown camera preset: ' + preset);
      if (flight) finishFlight('stop');
      restFlight = null;
      const wasFront = state.camera === 'pyramid-front';
      state.camera = preset;
      // free は今の視点のまま（移動中ならその行き先まで）。触ると移動をやめる
      if (preset === 'free') api.setOrbit(true);
      if (wasFront !== (preset === 'pyramid-front')) { rebuildCut(); updateCutUniforms(); applyForm(); }
      if (preset === 'free') { applyHighlight(); requestRender(); return; }
      applyHighlight();
      moveCamera(preset, animate);
      requestRender();
    },
    /** year: 断面の年（null で解除）。未来側の面を淡くする */
    setCutYear(year) {
      const y = year == null ? null : Math.round(Number(year));
      if (y === state.cutYear) return;
      state.cutYear = y;
      rebuildCut(); updateCutUniforms(); applyForm();
      if (state.camera === 'pyramid-front' && !camAnim) { const p = presetPose('pyramid-front', state.form); if (p) setPose(p); }
      requestRender();
    },
    /** ids: 強調する世代の id の配列（'dankai','hinoeuma','dankai-jr','postwar'）。'all' も可 */
    setHighlight(ids) {
      // getState() には渡された配列をそのまま返す（描画には既知の id だけを使う）
      state.highlight = ids === 'all' ? [...COHORT_IDS] : [...(ids || [])];
      applyHighlight();
      if (effCut() != null) rebuildCut();
      requestRender();
    },
    setOrbit(enabled) {
      state.orbit = !!enabled; controls.enabled = state.orbit && !flight;   // 飛行中は切ったまま（終わったら戻す）
      canvas.style.touchAction = state.orbit ? 'none' : '';
      if (state.orbit) { controls.update(); }
    },
    resize(w, h) {
      W = Math.max(1, Math.round(w)); H = Math.max(1, Math.round(h));
      renderer.setPixelRatio(pixelRatio());
      renderer.setSize(W, H, false);
      for (const m of lineMats) m.resolution.set(W, H);
      if (flight) {
        persp.aspect = W / H; persp.updateProjectionMatrix();
      } else if (restFlight) {
        const p = lookBackPose(restFlight);
        if (camAnim) camAnim.to = p; else setPose(p);
      } else if (state.camera !== 'free') {
        const p = presetPose(state.camera, state.form);
        if (camAnim) camAnim.to = p; else if (p) setPose(p);
      } else {
        persp.aspect = W / H; persp.updateProjectionMatrix();
        const hh = (ortho.top - ortho.bottom) / 2; ortho.left = -hh * W / H; ortho.right = hh * W / H; ortho.updateProjectionMatrix();
      }
      requestRender();
    },
    getState() {
      const fl = flight ? { cohort: flight.cohort, progress: flight.progress, year: flight.year, age: flight.age, clearance: flight.clearance } : null;
      return { form: state.form, camera: state.camera, cutYear: state.cutYear, highlight: [...state.highlight], flight: fl };
    },
    /**
     * 世代の尾根に沿って飛ぶ。cohortId は COHORT_IDS のいずれか。
     * onProgress({cohort, progress, birthYear, year, age, value, kazoe}) を毎フレーム、onEnd({reason, cohort}) を終わりに呼ぶ。
     * reducedMotion のときは飛ばず、経路の中ほどの視点を表示して、すぐ onEnd を呼ぶ。
     */
    fly(cohortId, { duration = FLY_MS, onProgress, onEnd } = {}) {
      const c = COHORTS.find(x => x.id === cohortId);
      if (!c) throw new Error('unknown cohort: ' + cohortId);
      if (flight) finishFlight('stop');
      const savedFov = camera === persp ? (restFlight ? restFlight.savedFov : persp.fov) : 33;
      restFlight = null; camAnim = null;
      // 形は地形型に固定する（地形型へ変形している途中なら、そのまま続けさせる）
      if (state.form !== 'terrain' || (!formAnim && formT !== 0)) {
        state.form = 'terrain'; formAnim = null; formT = 0; applyMorph(true); applyForm(); updateCutUniforms(); applyHighlight();
      }
      // 世代に複数の生まれ年があるときは中央の年の糸をたどる
      const path = buildFlightPath(M, Math.round((c.from + c.to) / 2));
      const f = { cohort: c.id, path, duration: Math.max(1, duration), onProgress, onEnd, savedFov, progress: 0, clearance: null };
      if (reducedMotion) {
        setPose(flyPose(path, 0.5)); keepAbove(); render();
        try { onProgress && onProgress(flightInfo(f, 0.5)); } catch (e) { console.error(e); }
        try { onEnd && onEnd({ reason: 'reduced', cohort: c.id }); } catch (e) { console.error(e); }
        return;
      }
      f.from = perspEquivalent(currentPose());
      f.start = performance.now();
      flight = f;
      showFlightThread(c);
      controls.enabled = false;
      applyHighlight();
      requestRender();
    },
    /** 飛行中なら止める（その場で元の画角に戻す。onEnd は reason 'stop' で呼ぶ） */
    stopFlight() { if (flight) finishFlight('stop'); },
    /** cb(result|null, {type:'hover'|'tap', x, y})。result は {sex, birthYear, year, age, value, kazoe, source, cohort}。戻り値で解除 */
    onPick(cb) { pickListeners.add(cb); return () => pickListeners.delete(cb); },
    /** 画面上の座標で拾う（テスト・キーボード操作用） */
    pickAt,
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf); if (hoverRaf) cancelAnimationFrame(hoverRaf);
      canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerdown', onFlightInterrupt, { capture: true });
      canvas.removeEventListener('wheel', onFlightInterrupt, { capture: true });
      flight = null; hideFlightThread();
      controls.dispose(); clearCut(); if (frameObj) frameObj.geometry.dispose();
      for (const o of disposables) o.dispose && o.dispose();
      labels.dispose(); pickListeners.clear();
      renderer.dispose();
    },
    /** 確認用：ワールド座標 → canvas 内の座標（px）。補間の形は今の表示に従う */
    _debug: {
      model: M, presets: PRE,
      project(p) { const v = new THREE.Vector3(...p).project(camera); return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H }; },
      isAnimating: () => !!(formAnim || camAnim || flight),
      /** 地形型の面の高さ（フライトの確認用） */
      surfaceHeight: (x, z) => surfaceHeight(M, x, z),
      cameraPosition: () => camera.position.toArray(),
      /** 補間値を固定して描く（確認用。次の setForm で元に戻る） */
      setFormT(t) { formAnim = null; formT = t; applyMorph(true); applyForm(); updateCutUniforms(); render(); },
    },
  };
  return api;
}
