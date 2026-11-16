// コホートの糸（docs/MOUNTAIN.md §3）。生まれ年 b の糸は、各年 y で年齢 a = y − b
// （数え年の年は a = y − b + 1）の点を通る。男女の面に 1 本ずつ引く。
import { SIGN, DIM, SEXES } from './geometry.js';

export const COHORTS = [
  { id: 'dankai', from: 1947, to: 1949, name: '団塊の世代' },
  { id: 'hinoeuma', from: 1966, to: 1966, name: '丙午' },
  { id: 'dankai-jr', from: 1971, to: 1974, name: '団塊ジュニア' },
  { id: 'postwar', from: 1945, to: 1946, name: '終戦前後', dashed: true },
];
export const COHORT_IDS = COHORTS.map(c => c.id);
export const cohortOfBirth = b => COHORTS.find(c => b >= c.from && b <= c.to) || null;

/** 基本の糸：5年おきの生まれ年 */
export function baseBirthYears(M) {
  const out = [];
  const first = Math.ceil((M.yMin - M.ageMax) / 5) * 5;
  for (let b = first; b <= M.yMax; b += 5) out.push(b);
  return out;
}

/**
 * 生まれ年の集合から糸の線分を作る。
 * 返り値：{ solid, dashed }。それぞれ { posA, posB, color(sex別のキー), meta }
 *   meta は線分ごとに { birthYear, sex, i0, i1 }（i は年の index）
 * 数え年（1944〜46年）に触れる線分は dashed に入れる。allDashed なら全部 dashed。
 */
export function buildThreads(M, births, { allDashed = false, liftT = DIM.threadLiftT, liftP = DIM.threadLiftP } = {}) {
  const mk = () => ({ posA: [], posB: [], sex: [], meta: [] });
  const solid = mk(), dashed = mk();
  const P = (i, sex, b) => {
    const a = M.ageOf(i, b); if (a < 0 || a > M.ageMax) return null;
    const v = M.val(i, sex, a); if (v == null) return null;
    const yr = M.years[i].year;
    return [[M.TX(yr), M.TH(v) + liftT, M.TZ(sex, a)], [SIGN[sex] * (M.PX(v) + liftP), M.PY(a + 0.5), M.PZ(yr)]];
  };
  for (const b of births) for (const sex of SEXES) {
    for (let i = 0; i + 1 < M.years.length; i++) {
      if (!M.consecutive(i)) continue;
      const p = P(i, sex, b), q = P(i + 1, sex, b); if (!p || !q) continue;
      const g = (allDashed || M.kazoe(i) || M.kazoe(i + 1)) ? dashed : solid;
      g.posA.push(...p[0], ...q[0]); g.posB.push(...p[1], ...q[1]); g.sex.push(sex);
      g.meta.push({ birthYear: b, sex, i0: i, i1: i + 1 });
    }
  }
  return { solid, dashed };
}
